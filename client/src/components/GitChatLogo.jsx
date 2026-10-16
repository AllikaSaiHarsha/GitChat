// GitChat mark — a redesigned, GitHub-flavored logo: the octocat's silhouette
// reimagined as a cat-eared speech bubble (GitHub's cat + a chat bubble).
export default function GitChatLogo({ size = 24 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 6 L8.6 2.2 L10.2 6 H13.8 L15.4 2.2 L17 6 A3 3 0 0 1 20 9 V15 A3 3 0 0 1 17 18 H11 L5.6 21.4 L8 18 H7 A3 3 0 0 1 4 15 V9 A3 3 0 0 1 7 6 Z" />
    </svg>
  );
}
