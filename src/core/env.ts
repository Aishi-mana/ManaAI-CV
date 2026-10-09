/** True when running inside the Tauri window (false in a plain browser tab). */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
