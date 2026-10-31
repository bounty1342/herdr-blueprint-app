// UI text in English (the default), Korean and Japanese. The language follows
// Claude Code's `language` setting (~/.claude/settings.json): the agent next to
// Blueprint answers in it. Anything else, or no setting, is English.
//
// What goes to the agent ("In Blueprint I pointed at ...") stays English: the
// Blueprint skill recognises that wording. The person's own note goes as typed.

export const LANGS = ["en", "ko", "ja"];

export function pickLang(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (/^(ko|kor|korean)\b/.test(v) || v.includes("한국")) return "ko";
  if (/^(ja|jp|jpn|japanese)\b/.test(v) || v.includes("日本")) return "ja";
  return "en";
}

// Shortcut keys typed with a Korean (2-set) or Japanese (kana) input source on:
// the same physical keys, as the characters they type.
export const KEY_ALIASES = { "ㄷ": "e", "ㄹ": "f", "い": "e", "は": "f" };

const TEXT = {
  en: {
    status: { working: "working", blocked: "needs you", done: "done", idle: "idle" },
    noAgent: "No agent",
    ago: (m) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`),
    edit: "Edit",
    editing: "Editing",
    editMode: "Edit mode",
    pickNode: "Click a node to change it · Esc to stop",
    enterSend: "Enter to send · Esc to cancel",
    placeholder: "What should change? e.g. add rate limiting here",
    noTarget: "No agent to send to",
    sendsWith: "Sends the box, where it is in the source, and its code",
    openAgent: "Open an agent in this tab to send",
    cancel: "Cancel",
    send: "Send",
    sending: "Sending…",
    sent: (name) => `Sent to ${name}`,
    sendFailed: "Couldn't send",
    noAgentBody: "Open an agent in this tab and send again",
    pngHover: "Move the pointer over the diagram once, then press PNG again",
    pngSaved: "PNG saved and copied",
    pngFailed: "Couldn't make the PNG",
    fit: "Fit",
    saving: "Saving…",
    hintEdit: "E to edit",
    hintEditing: "Click a node to ask its agent for a change",
    hintNarrow: "Click a node to see its flow",
    hint: "Click a node to light its flow · E to edit · drag to move · ⌘ scroll to zoom",
  },
  ko: {
    status: { working: "작업 중", blocked: "확인 필요", done: "완료", idle: "대기" },
    noAgent: "에이전트 없음",
    ago: (m) => (m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`),
    edit: "수정",
    editing: "수정 중",
    editMode: "수정 모드",
    pickNode: "바꿀 노드를 누르세요 · Esc 끝내기",
    enterSend: "Enter 보내기 · Esc 취소",
    placeholder: "무엇을 바꿀까요? 예: 여기에 rate limit 추가",
    noTarget: "보낼 에이전트 없음",
    sendsWith: "박스, 소스 위치, 연결된 코드와 함께 보냅니다",
    openAgent: "이 탭에 에이전트를 열면 보낼 수 있어요",
    cancel: "취소",
    send: "보내기",
    sending: "보내는 중…",
    sent: (name) => `${name}에게 보냈어요`,
    sendFailed: "보내지 못했어요",
    noAgentBody: "이 탭에 에이전트를 열고 다시 보내 주세요",
    pngHover: "포인터를 다이어그램 위에 한 번 올린 뒤 PNG를 다시 눌러 주세요",
    pngSaved: "PNG 저장, 클립보드에 복사",
    pngFailed: "PNG를 만들지 못했어요",
    fit: "맞춤",
    saving: "저장 중…",
    hintEdit: "수정하려면 E",
    hintEditing: "바꿀 노드를 누르면 담당 에이전트에게 요청해요",
    hintNarrow: "노드를 눌러 흐름 보기",
    hint: "노드를 누르면 연결된 흐름만 강조돼요 · E 수정 · 드래그로 이동 · ⌘ 스크롤로 확대",
  },
  ja: {
    status: { working: "作業中", blocked: "確認待ち", done: "完了", idle: "待機中" },
    noAgent: "エージェントなし",
    ago: (m) => (m < 1 ? "たった今" : m < 60 ? `${m}分前` : `${Math.floor(m / 60)}時間前`),
    edit: "編集",
    editing: "編集中",
    editMode: "編集モード",
    pickNode: "変えたいノードをクリック · Escで終了",
    enterSend: "Enterで送信 · Escでキャンセル",
    placeholder: "何を変えますか？ 例: ここにレート制限を追加",
    noTarget: "送信先のエージェントなし",
    sendsWith: "ボックス、ソース上の位置、対応するコードと一緒に送ります",
    openAgent: "このタブでエージェントを開くと送れます",
    cancel: "キャンセル",
    send: "送信",
    sending: "送信中…",
    sent: (name) => `${name}に送信しました`,
    sendFailed: "送信できませんでした",
    noAgentBody: "このタブでエージェントを開いてから、もう一度送ってください",
    pngHover: "一度ポインタを図の上に乗せてから、PNGをもう一度押してください",
    pngSaved: "PNGを保存してコピーしました",
    pngFailed: "PNGを作れませんでした",
    fit: "全体",
    saving: "保存中…",
    hintEdit: "Eで編集",
    hintEditing: "ノードをクリックすると担当エージェントに依頼します",
    hintNarrow: "ノードをクリックで流れを表示",
    hint: "ノードをクリックで流れを強調 · E 編集 · ドラッグで移動 · ⌘スクロールで拡大",
  },
};

export const text = (lang) => TEXT[lang] ?? TEXT.en;
