import { writable } from 'svelte/store';

/** The person whose profile card is open, and the element they were opened from (it anchors the card and gets focus back on close). `null` = closed. */
export interface OpenProfileCard {
  userId: string;
  trigger: HTMLElement;
}

export const profileCard = writable<OpenProfileCard | null>(null);

export function openProfileCard(userId: string, trigger: HTMLElement): void {
  profileCard.set({ userId, trigger });
}

export function closeProfileCard(): void {
  profileCard.set(null);
}
