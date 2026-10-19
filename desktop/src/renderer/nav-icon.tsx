// Original Matheca icons: 24-unit grid, 18-unit optical field, 1.7-unit stroke.
const icons = {
  database: {
    body: "M6 3.5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z",
    detail: "M4 9h16M4 15h16M7.5 6.3h.1M7.5 12h.1M7.5 17.7h.1",
  },
  "folder-open": {
    body: "M3 7a2 2 0 0 1 2-2h4.5l2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
    detail: "M3 11h18",
  },
  bulb: {
    body: "M8 17c0-3-3-3.5-3-7a7 7 0 0 1 14 0c0 3.5-3 4-3 7v1H8Z",
    detail: "M9 21h6M12 17v-5M9.5 9.5 12 12l2.5-2.5",
  },
  "file-done": {
    body: "M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z",
    detail: "M9 8h6M8.5 14l2.5 2.5 4.5-5",
  },
  history: {
    body: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    detail: "M12 6.5V12l3.5 2.5",
  },
  setting: {
    body: "M10 3h4l.6 2.4 1.6.9 2.4-.7 2 3.4-1.8 1.7v2.6L20.6 15l-2 3.4-2.4-.7-1.6.9L14 21h-4l-.6-2.4-1.6-.9-2.4.7-2-3.4 1.8-1.7v-2.6L3.4 9l2-3.4 2.4.7 1.6-.9Z",
    detail: "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  },
} as const;
export type NavIconName = keyof typeof icons;
export function NavIcon({
  name,
  selected = false,
}: {
  name: NavIconName;
  selected?: boolean;
}) {
  const icon = icons[name];
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={icon.body}
        fill="none"
        stroke={selected ? "var(--blue)" : "currentColor"}
      />
      <path
        d={icon.detail}
        fill="none"
        stroke={selected ? "var(--blue)" : "currentColor"}
      />
    </svg>
  );
}
