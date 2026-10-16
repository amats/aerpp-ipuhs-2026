# AERPP

[English](README.md) | 日本語

AERPP（AI-assisted Ethical Review Pre-Processing）は、研究倫理審査への申請準備を支援するシステムです。この pnpm ワークスペースには、研究参加者向けアプリケーション、管理者向けアプリケーション、Support API が含まれています。分析対象の文書と分析結果は、オンプレミスのローカル LLM のみで処理し、クラウドサービスへの送信やアプリケーションサーバーへの永続保存は行いません。

| ディレクトリ | 役割 |
| --- | --- |
| [apps/web](apps/web/README.md) | 研究参加者向けの利用フロー、文書の準備、ローカル LLM による分析 |
| [apps/admin](apps/admin/README.md) | 権限のある管理者によるアンケート回答・運用情報の閲覧 |
| [apps/support](apps/support/README.md) | 研究参加者向け API、メールアドレスの確認、定期クリーンアップ |
| [packages/config](packages/config/README.md) | 共通設定とシークレット取得処理の仕様 |
| [packages/contracts](packages/contracts/README.md) | 研究参加者 API の共通リクエスト・レスポンススキーマと OpenAPI 仕様 |
| [packages/documents](packages/documents/README.md) | 研究参加者向け PDF の共通生成処理と日本語フォント |
| [packages/firestore](packages/firestore/README.md) | 研究参加者データとお知らせの共通保存・取得処理 |
| [infra](infra/README.md) | 運用用 Mac のバンドルと [Terraform によるクラウド基盤](infra/terraform/README.md) |

## 目的に応じた始め方

| 目的 | 最初に読む資料 | 必要なもの |
| --- | --- | --- |
| ソースコードの確認・ビルド・テスト | [ローカルでの検証](docs/development.md#first-run-without-cloud-credentials) | 開発ツールと Git で管理されている Web 用研究資料。クラウドアカウントやモデルの起動は不要 |
| 研究データのエクスポート形式の確認 | [テスト用データを使ったエクスポート例](apps/admin/docs/data-export.md#synthetic-sample) | ロックファイルに従ってインストールした依存パッケージ。クラウド上のデータやログインは不要 |
| 自分の研究に合わせた AERPP の調整 | [設定例とカスタマイズの範囲](docs/examples.md) | 研究資料、質問票、研究に合わせて定めた実施条件 |
| テスト用クラウドに接続した開発、または運用システムの導入 | [スクリプトを利用したセットアップ](docs/setup.md) | 非公開の設定、Google Cloud、OAuth/Gmail、運用機器 |

運用システムは、オンプレミスの Web/LM Studio と、Google Cloud 上の Support、Admin、Firestore を組み合わせて構成します。ローカルテストではエミュレーターとスタブを使用しますが、クラウドを一切使わない本番構成へ切り替える設定はありません。提供する運用バンドルは Apple Silicon Mac を対象としています。別のプラットフォームやワークフローを選ぶ前に、[対応範囲](docs/examples.md#supported-scope-and-customization)を確認してください。

## 初回実行

[開発マシンの準備](docs/setup.md#1-prepare-the-source-and-development-machine)に従ってリポジトリをクローンし、リポジトリに含まれる Dev Container 設定を使って開いてください。Dev Container の初期セットアップでは依存パッケージがインストールされます。Dev Container を使わずホスト環境で作業する場合は、先に[依存パッケージのインストール](docs/development.md#first-run-without-cloud-credentials)を完了してください。

`apps/web/assets-public/` の[公開研究資料](docs/examples.md#research-assets)はリポジトリに含まれています。ローカル開発やビルドでは、`apps/web/assets/` が用意されていればそちらを優先します。準備ができたら、ワークスペースのルートで次のコマンドを実行します。

```sh
pnpm run env:check example
pnpm run build
```

これらのコマンドは、検証用の設定と選択された Web 用研究資料を使用して、すべてのアプリケーションをビルドします。クラウドの認証情報やモデルの起動は不要です。サービスは起動しません。続いて、[ローカルテストと Web プレビュー](docs/development.md#first-run-without-cloud-credentials)に進んでください。

## クラウドに接続した開発

以下のコマンドを使う前に、[テスト環境のセットアップ](docs/setup.md)に従い、Support のデプロイ、Admin の OAuth 設定、運用担当者のアクセス設定を完了してください。Web で分析する場合は、**開発ホスト**で LM Studio を起動し、選択したモデルを読み込んでください。接続方法は[想定環境](docs/environments.md#intended-environment)を参照してください。

```sh
pnpm run env:run test web dev
# 別のターミナルで実行:
pnpm run env:run test admin dev
```

Web はポート 3000、Admin はポート 3001 を使用します。`dev:web` と `dev:admin` は、このテスト用クラウドに接続する起動コマンドのショートカットです。初回実行用のローカルプレビューとは異なります。本番環境では、別途[デプロイの受け入れ検証](docs/deployment.md#release-acceptance)が必要です。

## ドキュメント

目的別の読み進め方、各ガイドの対象範囲、アプリケーション・パッケージごとの資料は、[ドキュメント一覧](docs/README.md)を参照してください。開発に参加する方は [CONTRIBUTING.md](CONTRIBUTING.md) から、運用担当者は[セットアップ](docs/setup.md)と[デプロイ](docs/deployment.md)から読み進めてください。

変更履歴は [CHANGELOG.md](CHANGELOG.md)、脆弱性の報告方法は [SECURITY.md](SECURITY.md)、第三者ソフトウェアの著作権・ライセンス表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
