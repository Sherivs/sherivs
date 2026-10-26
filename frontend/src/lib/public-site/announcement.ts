/**
 * Public announcement bar. Rendered only when `published` is true.
 * Never invent a launch date, promotion, or product announcement.
 */
export interface PublicAnnouncement {
  published: boolean;
  text: string;
  href?: string;
  hrefLabel?: string;
}

export const PUBLIC_ANNOUNCEMENT: PublicAnnouncement = {
  published: false,
  text: "",
};
