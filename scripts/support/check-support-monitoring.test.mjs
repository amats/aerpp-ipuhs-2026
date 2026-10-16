import assert from "node:assert/strict"
import { test } from "node:test"
import { assertSupportMonitoring } from "./check-support-monitoring.mjs"

import { supportErrorLogFilter } from "./support-monitoring-policy.mjs"

const PROJECT = "synthetic-project"
const EMAIL = "operator@example.invalid"
const CHANNELS = [
  {
    name: `projects/${PROJECT}/notificationChannels/operator`,
    displayName: "AERPP support operator",
    enabled: true,
    type: "email",
    labels: { email_address: EMAIL },
  },
]
const ALERTS = [
  {
    name: `projects/${PROJECT}/alertPolicies/errors`,
    displayName: "AERPP support errors and maintenance failures",
    enabled: true,
    combiner: "OR",
    conditions: [
      { conditionMatchedLog: { filter: supportErrorLogFilter(PROJECT) } },
    ],
    alertStrategy: {
      notificationRateLimit: { period: "3600s" },
      autoClose: "1800s",
    },
    notificationChannels: [`projects/${PROJECT}/notificationChannels/operator`],
  },
]

test("error monitoring acceptance requires the enabled policy and selected notification destination", () => {
  assert.deepEqual(assertSupportMonitoring(CHANNELS, ALERTS, EMAIL, PROJECT), {
    channel: CHANNELS[0],
    policy: ALERTS[0],
  })
  for (const channels of [
    [],
    [{ ...CHANNELS[0], enabled: false }],
    [{ ...CHANNELS[0], labels: { email_address: "other@example.invalid" } }],
  ])
    assert.throws(() =>
      assertSupportMonitoring(channels, ALERTS, EMAIL, PROJECT),
    )
  for (const alerts of [
    [],
    [{ ...ALERTS[0], enabled: false }],
    [{ ...ALERTS[0], notificationChannels: [] }],
  ])
    assert.throws(() =>
      assertSupportMonitoring(CHANNELS, alerts, EMAIL, PROJECT),
    )
})

test("monitoring acceptance requires explicit boolean enablement", () => {
  for (const enabled of [
    undefined,
    null,
    1,
    "true",
    "false",
    { result: true },
    [],
  ]) {
    assert.throws(() =>
      assertSupportMonitoring(
        [{ ...CHANNELS[0], enabled }],
        ALERTS,
        EMAIL,
        PROJECT,
      ),
    )
    assert.throws(() =>
      assertSupportMonitoring(
        CHANNELS,
        [{ ...ALERTS[0], enabled }],
        EMAIL,
        PROJECT,
      ),
    )
  }
})

test("monitoring acceptance rejects filter drift, wrong conditions and changed alert timing", () => {
  const policy = ALERTS[0]
  for (const change of [
    { conditions: [] },
    { conditions: [...policy.conditions, ...policy.conditions] },
    { conditions: [{ conditionThreshold: { filter: "severity>=ERROR" } }] },
    {
      conditions: [
        {
          conditionMatchedLog: {
            filter: 'resource.type="unrelated_resource" AND severity=EMERGENCY',
          },
        },
      ],
    },
    {
      conditions: [
        {
          conditionMatchedLog: {
            filter: supportErrorLogFilter("other-project"),
          },
        },
      ],
    },
    {
      conditions: [
        {
          conditionMatchedLog: {
            filter: `${supportErrorLogFilter(PROJECT)} AND httpRequest.status!=503`,
          },
        },
      ],
    },
    {
      conditions: [
        {
          conditionMatchedLog: {
            filter: supportErrorLogFilter(PROJECT),
            labelExtractors: { unsafe: "EXTRACT(jsonPayload.message)" },
          },
        },
      ],
    },
    { combiner: "AND" },
    { alertStrategy: undefined },
    {
      alertStrategy: {
        ...policy.alertStrategy,
        notificationRateLimit: { period: "86400s" },
      },
    },
    { alertStrategy: { ...policy.alertStrategy, autoClose: "86400s" } },
    { name: "projects/other-project/alertPolicies/errors" },
    {
      notificationChannels: [
        ...policy.notificationChannels,
        "projects/other-project/notificationChannels/other",
      ],
    },
  ])
    assert.throws(() =>
      assertSupportMonitoring(
        CHANNELS,
        [{ ...policy, ...change }],
        EMAIL,
        PROJECT,
      ),
    )
  assert.throws(() =>
    assertSupportMonitoring([...CHANNELS, ...CHANNELS], ALERTS, EMAIL, PROJECT),
  )
  assert.throws(() =>
    assertSupportMonitoring(CHANNELS, [...ALERTS, ...ALERTS], EMAIL, PROJECT),
  )
  assert.throws(() =>
    assertSupportMonitoring(
      [
        {
          ...CHANNELS[0],
          name: "projects/other-project/notificationChannels/operator",
        },
      ],
      ALERTS,
      EMAIL,
      PROJECT,
    ),
  )
})

test("monitoring accepts harmless filter formatting but preserves literal match values", () => {
  const filter = supportErrorLogFilter(PROJECT)
  const policy = {
    ...ALERTS[0],
    conditions: [
      {
        conditionMatchedLog: {
          filter: `\n ${filter.replaceAll(" AND ", "\n AND \t")} \n`,
        },
      },
    ],
  }
  assert.doesNotThrow(() =>
    assertSupportMonitoring(CHANNELS, [policy], EMAIL, PROJECT),
  )
  policy.conditions[0].conditionMatchedLog.filter = filter.replace(
    '="support"',
    '=" support"',
  )
  assert.throws(() =>
    assertSupportMonitoring(CHANNELS, [policy], EMAIL, PROJECT),
  )
})

test("the canonical Support filter includes platform 5xx without blanket route exclusions", () => {
  const filter = supportErrorLogFilter(PROJECT)
  assert.match(filter, /httpRequest.status>=500/)
  assert.match(filter, /labels\."aerpp-component"="support"/)
  assert.doesNotMatch(filter, /service_name|requestUrl|status=503/)
  assert.match(
    filter,
    /AND NOT \(jsonPayload.code="ADMISSION_CLOSED" OR jsonPayload.code="WITHDRAWAL_CLEANUP_PENDING"\)/,
  )
  assert.match(filter, /cloud_scheduler_job/)
  assert.match(
    filter,
    /projects\/synthetic-project\/logs\/aerpp-support-alert-test/,
  )
})

test("monitoring acceptance rejects malformed destination and policy references", () => {
  for (const email of [undefined, null, "", " "])
    assert.throws(() =>
      assertSupportMonitoring(CHANNELS, ALERTS, email, PROJECT),
    )
  for (const name of [undefined, null, "", 123]) {
    assert.throws(() =>
      assertSupportMonitoring(
        [{ ...CHANNELS[0], name }],
        ALERTS,
        EMAIL,
        PROJECT,
      ),
    )
    assert.throws(() =>
      assertSupportMonitoring(
        CHANNELS,
        [{ ...ALERTS[0], name }],
        EMAIL,
        PROJECT,
      ),
    )
  }
  for (const notificationChannels of [
    undefined,
    null,
    `projects/${PROJECT}/notificationChannels/operator`,
    {},
  ])
    assert.throws(() =>
      assertSupportMonitoring(
        CHANNELS,
        [{ ...ALERTS[0], notificationChannels }],
        EMAIL,
        PROJECT,
      ),
    )
})
