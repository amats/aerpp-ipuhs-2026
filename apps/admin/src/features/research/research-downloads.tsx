import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import ExportDownloadButton from "./export-download-button"

export default function ResearchDownloads() {
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <CardSection className="xl:col-span-2">
        <SectionHeading
          title="研究・参加管理データの出力"
          description="全期間・全サーバーの記録を出力します。実データ・テスト・未分類を含み、画面の絞り込みは適用しません。研究用データからは撤回対象を除外し、参加管理・アクセスデータには撤回後の履歴を含みます。"
        />
        <p className="max-w-3xl">
          解析対象の選定と、出力後に受け付けた撤回の確認はオフラインで行ってください。撤回対象は過去に保存した研究データも含めて削除してください。すでに削除された記録は出力できません。
        </p>
      </CardSection>
      <CardSection>
        <SectionHeading
          title="研究用データ"
          description="アンケート回答・自由記述、解析の開始／終了・成否、解析時間、文書文字数、質問票定義と原本JSONを含みます。メールアドレスの管理項目は除外します。"
        />
        <p>
          自由記述は個人情報を含まない前提で、入力された内容をそのまま出力します。保存済みの有効な解析時間を含み、撤回対象の解析時間は出力しません。
        </p>
        <div className="mt-auto">
          <ExportDownloadButton
            dataset="research"
            label="研究用データを保存（ZIP）"
          />
        </div>
      </CardSection>
      <CardSection>
        <SectionHeading
          title="参加管理・アクセスデータ"
          description="復号済みのメールアドレス、同意／撤回履歴、参加状態と、認証・解析・アンケート回答の日時を含みます。回答本文は含みません。"
        />
        <p>
          メールアドレスを復号できない場合は、email欄に「復号できません」と記載します。該当する記録も出力に含め、同意／撤回のDIDは空欄（JSONではnull）にします。
        </p>
        <p>
          メールアドレスを含むため、研究用データとは分けて保管してください。撤回後も操作日時・成否・復旧の経緯と削除状況を保持します。保存前に失われた履歴は復元できません。ページ閲覧履歴やIPアドレスは含みません。
        </p>
        <div className="mt-auto">
          <ExportDownloadButton
            dataset="access"
            label="参加管理・アクセスデータを保存（ZIP）"
          />
        </div>
      </CardSection>
      <p className="max-w-3xl xl:col-span-2">
        各ZIPにはJSON・CSVと出力件数を含みます。欠損・空文字・nullの区別にはJSONを使用してください。個別ダウンロードはそれぞれ新しい取得時点になります。
      </p>
    </div>
  )
}
