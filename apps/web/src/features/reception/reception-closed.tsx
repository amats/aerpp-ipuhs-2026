export default function ReceptionClosed({
  contactEmail,
}: {
  contactEmail: string
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-3 text-sm font-semibold">AERPP</p>
        <h1 className="text-2xl font-bold" tabIndex={-1}>
          受付は終了しました
        </h1>
        <p className="mt-5">本システムの受付期間は終了しました。</p>
        <p className="mt-3">ご協力ありがとうございました。</p>
        <p className="mt-5 text-sm">
          この画面への切り替えによって、参加の撤回や登録済みデータの削除は行われません。
        </p>
        <p className="mt-5">
          受付終了後のお問い合わせや参加の撤回をご希望の場合は、次の連絡先へご連絡ください。
        </p>
        <a
          className="mt-2 inline-flex min-h-11 items-center rounded underline underline-offset-4 wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-4"
          href={`mailto:${contactEmail}`}
        >
          {contactEmail}
        </a>
      </section>
    </main>
  )
}
