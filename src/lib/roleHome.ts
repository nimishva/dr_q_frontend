export type AppRole = "patient" | "doctor" | "admin" | "clinic_admin" | "clinic_staff";

export function roleHomePath(role: AppRole): "/patient" | "/doctor" | "/clinic" {
  if (role === "patient") return "/patient";
  if (role === "doctor") return "/doctor";
  // Platform admin and clinic roles should not bounce between patient/doctor pages.
  return "/clinic";
}

