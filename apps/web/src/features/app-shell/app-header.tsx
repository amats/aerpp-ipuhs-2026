export default function AppHeader() {
  return (
    <header className="w-full rounded-2xl border border-white/60 bg-linear-to-r from-(--brand-blue) to-sky-700 px-6 py-5 text-white shadow-md shadow-[rgba(15,23,42,0.16)] sm:px-8 sm:py-6 lg:px-10 dark:border-white/10 dark:from-blue-700">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-white uppercase">
          AERPP
        </p>
        <h1 className="max-w-5xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          研究「倫理申請書類の解析を行うAIシステムの評価」
        </h1>
      </div>
    </header>
  )
}
