import type { DocumentData, Transaction } from "@google-cloud/firestore"
// In-memory optimistic transactions: immutable snapshots, version validation,
// automatic retries, atomic commits, and reads-before-writes enforcement.
export class Timestamp {
  constructor(private millis: number) {}
  static now() {
    return new Timestamp(Date.now())
  }
  static fromMillis(millis: number) {
    return new Timestamp(millis)
  }
  static fromDate(date: Date) {
    return new Timestamp(date.getTime())
  }
  toMillis() {
    return this.millis
  }
  toDate() {
    return new Date(this.millis)
  }
}
type Data = DocumentData
function clone<T>(value: T): T {
  if (value instanceof Timestamp) return new Timestamp(value.toMillis()) as T
  if (Array.isArray(value)) return value.map(clone) as T
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    ) as T
  return value
}
class Ref {
  constructor(
    readonly db: MemoryFirestore,
    readonly path: string,
  ) {}
  get id() {
    return this.path.split("/").slice(-1)[0]
  }
  get() {
    return Promise.resolve(this.db.snapshot(this))
  }
  async set(data: Data) {
    this.db.seed(this.path, data)
  }
}
class Query {
  constructor(
    readonly db: MemoryFirestore,
    readonly path: string,
    readonly filters: [string, string, unknown][] = [],
    readonly maximum = Infinity,
    readonly cursor = "",
  ) {}
  where(key: string, op: string, value: unknown) {
    if (op !== "==" && !(op === "!=" && value === null))
      throw new Error("unsupported mock operator")
    return new Query(
      this.db,
      this.path,
      [...this.filters, [key, op, value]],
      this.maximum,
      this.cursor,
    )
  }
  limit(size: number) {
    return new Query(this.db, this.path, this.filters, size, this.cursor)
  }
  orderBy(key: string) {
    if (key !== "__name__") throw new Error("unsupported mock ordering")
    return this
  }
  startAfter(cursor: string) {
    return new Query(this.db, this.path, this.filters, this.maximum, cursor)
  }
  doc(id = String(++this.db.nextId).padStart(20, "A")) {
    return new Ref(this.db, `${this.path}/${id}`)
  }
  async add(data: Data) {
    const ref = this.doc()
    this.db.seed(ref.path, data)
    return ref
  }
  async get() {
    return this.db.query(this)
  }
  count() {
    return {
      get: async () => ({ data: () => ({ count: this.db.query(this).size }) }),
    }
  }
}
export class MemoryFirestore {
  records = new Map<string, Data>()
  versions = new Map<string, number>()
  nextId = 0
  retries = 0
  deleteByteLimit = Infinity
  commits = 0
  writesPerCommit: number[] = []
  beforeCommit?: (
    writes: { kind: string; ref: Ref; data?: Data }[],
  ) => Promise<void>
  failCommit?: (writes: { kind: string; ref: Ref; data?: Data }[]) => boolean
  collection(name: string) {
    return new Query(this, name)
  }
  seed(path: string, data: Data) {
    this.records.set(path, clone(data))
    this.bump(path)
  }
  data(path: string) {
    return clone(this.records.get(path))
  }
  private bump(path: string) {
    for (const key of [path, `query:${path.split("/")[0]}`])
      this.versions.set(key, (this.versions.get(key) ?? 0) + 1)
  }
  snapshot(ref: Ref) {
    const data = this.data(ref.path)
    return {
      ref,
      id: ref.id,
      exists: data !== undefined,
      data: () => clone(data),
    }
  }
  query(query: Query) {
    const docs = [...this.records]
      .filter(
        ([path, data]) =>
          path.split("/")[0] === query.path &&
          path.split("/")[1] > query.cursor &&
          query.filters.every(([key, op, value]) =>
            op === "=="
              ? data[key] === value
              : data[key] !== undefined && data[key] !== null,
          ),
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, query.maximum)
      .map(([path]) => this.snapshot(new Ref(this, path)))
    return { docs, size: docs.length, empty: docs.length === 0 }
  }
  async runTransaction<T>(
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const reads = new Map<string, number>()
      const writes: { kind: string; ref: Ref; data?: Data; merge?: boolean }[] =
        []
      const tx = {
        get: async (target: Ref | Query) => {
          if (writes.length) throw new Error("read after write")
          const key =
            target instanceof Ref ? target.path : `query:${target.path}`
          reads.set(key, this.versions.get(key) ?? 0)
          return target instanceof Ref
            ? this.snapshot(target)
            : this.query(target)
        },
        create: (ref: Ref, data: Data) => {
          writes.push({ kind: "create", ref, data })
        },
        set: (ref: Ref, data: Data, options?: { merge: boolean }) => {
          writes.push({ kind: "set", ref, data, merge: options?.merge })
        },
        update: (ref: Ref, data: Data) => {
          writes.push({ kind: "update", ref, data, merge: true })
        },
        delete: (ref: Ref) => {
          writes.push({ kind: "delete", ref })
        },
      }
      const result = await callback(tx as unknown as Transaction)
      const hook = this.beforeCommit
      this.beforeCommit = undefined
      if (hook) await hook(writes)
      if (
        [...reads].some(
          ([key, version]) => (this.versions.get(key) ?? 0) !== version,
        )
      ) {
        this.retries++
        continue
      }
      const deleteBytes = writes
        .filter((write) => write.kind === "delete")
        .reduce(
          (total, write) =>
            total +
            new TextEncoder().encode(JSON.stringify(this.data(write.ref.path)))
              .length,
          0,
        )
      if (deleteBytes > this.deleteByteLimit)
        throw Object.assign(new Error("transaction size limit"), { code: 3 })
      if (this.failCommit?.(writes))
        throw new Error("injected commit failure containing private data")
      if (writes.length > 500) throw new Error("unbounded transaction")
      for (const write of writes) {
        if (write.kind === "create" && this.records.has(write.ref.path))
          throw new Error("already exists")
        if (write.kind === "update" && !this.records.has(write.ref.path))
          throw new Error("missing update")
      }
      for (const write of writes) {
        if (write.kind === "delete") {
          this.records.delete(write.ref.path)
          this.bump(write.ref.path)
        } else
          this.seed(write.ref.path, {
            ...(write.merge ? this.data(write.ref.path) : {}),
            ...write.data,
          })
      }
      this.commits++
      this.writesPerCommit.push(writes.length)
      return result
    }
    throw new Error("retry exhausted")
  }
}
