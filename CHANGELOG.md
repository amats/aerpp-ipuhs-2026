# Changelog

Notable changes to this project are documented here. Versioning and publishing
follow [source releases](docs/releases.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-11-23

### Added

- OSF study preregistration links, English and Japanese citation guidance, and
  software citation metadata identifying the published `v1.0.0` source release.

### Changed

- Update Next.js, Google Cloud client libraries, PDF and ZIP handling, and
  development tools. Run `pnpm install --frozen-lockfile` to install them, then
  `pnpm run test:e2e:install` to refresh Chromium for browser tests.
- Update the Dev Container's Docker-outside-of-Docker feature to 1.10.3.
  Rebuild the Dev Container to use the updated Docker tooling.
- Keep Dependabot's Node.js runtime, development-image and type-definition
  updates within the declared Node.js 24 baseline.

### Fixed

- Update the Support API's Express dependencies `body-parser` and `qs` to
  address security advisories GHSA-27r3-jxmh-p828 and GHSA-6pq8-jhm2-2vcw.
- Update the Vite dependency used by Vitest to 8.3.8 to address six
  development-server security advisories.

## [1.0.0] - 2026-10-16

### Added

- Initial source release of AERPP, with participant Web, administrator and Support
  applications for research ethics application preparation and study evaluation.
- On-premises document analysis through a local LLM, with browser-side recovery
  and result export. Analysis documents and results remain outside cloud flows
  and application-server persistence.
- Email verification, consent and withdrawal, participant PDF documents,
  questionnaires, and authorized administration and research exports.
- Shared configuration, participant API contracts, PDF rendering and Firestore
  persistence, with separate test and production environments.
- Public setup templates, synthetic verification workflows, Terraform
  infrastructure and private Apple Silicon Mac distribution tooling, together
  with installation, operation, security and third-party license documentation.
