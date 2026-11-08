/** Login namespace is distinct from email and from non-unique display names. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,29}$/;
export const normalizeUsername = (value: string) => value.trim().toLowerCase();
