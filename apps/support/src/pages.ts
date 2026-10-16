const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  )
function page(title: string, contents: string, script = "") {
  const shellClass = script ? "shell shell-confirmation" : "shell"
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title} | AERPP</title><link rel="stylesheet" href="/assets/support.css"></head><body><a class="skip-link" href="#main">本文へ移動</a><div class="${shellClass}"><header class="brand"><a href="/" aria-label="AERPP 研究参加サポート ホーム">AERPP</a><p>研究「倫理申請書類の解析を行うAIシステムの評価」</p></header><main id="main" tabindex="-1"><div class="page-heading"><p class="eyebrow">研究参加サポート</p><h1>${title}</h1></div><section class="card" aria-label="${title}">${contents}</section></main><footer><nav aria-label="サポート情報"><a href="/privacy">プライバシー</a><a href="/terms">利用について</a><a href="/contact">お問い合わせ</a></nav><p>AERPP · 研究参加サポート</p></footer></div>${script}</body></html>`
}
export function publicPages(contactEmail: string) {
  return {
    "/": page(
      "研究参加の手続きをご案内します",
      '<p class="lead">メール確認と研究参加の手続きを支援します。文書の解析は施設内のアプリで行います。</p><h2>メール確認の流れ</h2><ol class="steps"><li><strong>確認メールを開く</strong><span>参加アプリで届いた案内に従い、メール内のリンクを開きます。</span></li><li><strong>確認ボタンを押す</strong><span>確認画面で説明を読み、メールアドレスを確認します。</span></li><li><strong>参加アプリに戻る</strong><span>元の画面に戻り、研究参加の手続きを続けてください。</span></li></ol><aside class="notice"><h2>解析文書・解析結果について</h2><p>施設内で処理し、このクラウドサービスには送信・保存しません。</p></aside><div class="links"><a href="/terms">利用について →</a><a href="/contact">お困りの方はこちら →</a></div>',
    ),
    "/privacy": page(
      "プライバシー",
      "<h2>取り扱う情報</h2><p>解析文書と解析結果は施設内で処理し、このクラウドサービスには送信・保存しません。同意履歴、認証状態、質問票と限定された処理状況を研究参加手続きのために管理します。</p><h2>確認メールと参加撤回</h2><p>Gmail は確認メール送信のために利用します。参加撤回に伴う Firestore の削除処理は、Gmail の送信済みメールを削除しません。</p>",
    ),
    "/terms": page(
      "利用について",
      "<h2>研究参加について</h2><p>研究への参加は、施設からの案内と説明文書をご確認のうえ、ご自身の意思でお決めください。</p><h2>メール確認後の操作</h2><p>メール確認後は、元の参加アプリに戻って手続きを続けてください。</p>",
    ),
    "/contact": page(
      "お問い合わせ",
      `<p class="lead">研究参加の手続きでお困りの場合は、以下の窓口へお問い合わせください。</p><h2>お問い合わせ先</h2><p class="contact"><a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></p>`,
    ),
    "/email/confirm": page(
      "メールアドレスの確認",
      '<p class="lead">確認ボタンを押すと、このメールに対応する研究参加の同意が記録されます。</p><form id="confirm"><button type="submit">メールアドレスを確認する</button></form><div id="status" class="status" role="status" aria-live="polite" aria-atomic="true" hidden></div><aside class="notice"><h2>確認が終わったら</h2><p>この画面を閉じて、メールを送信した元の画面に戻り、「次に進む」を押してください。</p></aside><noscript>確認には JavaScript が必要です。元の参加アプリから案内をご確認ください。</noscript>',
      '<script src="/assets/confirmation.js" defer></script>',
    ),
  }
}
export const CONFIRMATION_SCRIPT = `"use strict";
(() => {
  let consentId, token, generation = 0, retryTimer, pendingTimer;
  const form = document.getElementById("confirm");
  const status = document.getElementById("status");
  const button = form.querySelector("button");
  function showStatus(state, message) {
    status.hidden = !message;
    status.dataset.state = state;
    status.textContent = message;
    form.setAttribute("aria-busy", String(state === "pending"));
    button.textContent = state === "pending" ? "確認しています…" : state === "success" ? "確認完了" : "メールアドレスを確認する";
  }
  function readLink() {
    clearTimeout(retryTimer);
    clearTimeout(pendingTimer);
    const params = new URLSearchParams(location.hash.slice(1));
    consentId = params.get("consentId"); token = params.get("token"); generation++;
    history.replaceState(null, "", location.pathname);
    form.hidden = false;
    button.disabled = !/^[A-Za-z0-9]{20}$/.test(consentId || "") || !/^[A-Za-z0-9_-]{43}$/.test(token || "");
    showStatus(button.disabled ? "error" : "ready", button.disabled ? "確認リンクが無効です。元の参加アプリから確認メールを再送してください。" : "");
  }
  readLink();
  window.addEventListener("hashchange", readLink);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (button.disabled) return;
    button.disabled = true; const current = generation;
    showStatus("pending", "メールアドレスを確認しています。しばらくお待ちください。");
    pendingTimer = setTimeout(() => {
      if (current === generation) showStatus("pending", "受付結果の確認に時間がかかっています。しばらくお待ちください。");
    }, 15000);
    try {
      const response = await fetch("/email/confirm", { method: "POST", signal: AbortSignal.timeout(30_000), credentials: "omit", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consentId, token }) });
      const result = await response.json();
      if (current !== generation) return;
      if (response.ok === true || result.code === "AUTHENTICATION_USED") showStatus("success", "メール確認は完了しています。メールを送信した元の画面に戻り、「次に進む」を押してください。");
      else if (result.code === "RATE_LIMITED") {
        const header = response.headers.get("Retry-After");
        const seconds = /^\\d{1,4}$/.test(header || "") ? Math.max(1, Math.min(300, Number(header))) : 1;
        showStatus("waiting", "確認要求が混み合っています。" + seconds + "秒後に、もう一度確認ボタンを押してください。");
        retryTimer = setTimeout(() => {
          if (current !== generation) return;
          showStatus("ready", "もう一度確認ボタンを押してください。"); button.disabled = false;
        }, seconds * 1000);
      }
      else if (result.code === "RECEPTION_CLOSED") { form.hidden = true; showStatus("closed", "受付は終了しました。研究参加の同意は登録されていません。この画面を閉じてください。"); }
      else if (result.code === "AUTHENTICATION_EXPIRED") showStatus("error", "認証リンクの有効期限が切れています。再送しても期限は延長されません。元の画面で「次に進む」を押して状態を確認し、表示される案内に従って保存データを初期化し、同意とメール認証をやり直してください。");
      else if (result.code === "CONSENT_SUPERSEDED" || result.code === "WITHDRAWAL_CLEANUP_PENDING") showStatus("error", "この同意では認証を続けられません。元の画面で参加状態とデータ削除の完了を確認してください。");
      else if (result.code === "AUTHENTICATION_INVALID") showStatus("error", "この認証リンクを確認できません。元の画面で「次に進む」を押し、表示される案内に従ってください。");
      else { showStatus("error", "認証を完了できませんでした。時間をおいて、もう一度確認ボタンを押してください。"); button.disabled = false; }
    } catch { if (current !== generation) return; showStatus("error", "受付結果を確認できませんでした。同じ確認ボタンを押して、受付状況を確認してください。"); button.disabled = false; }
    finally { if (current === generation) clearTimeout(pendingTimer); }
  });
})();`
