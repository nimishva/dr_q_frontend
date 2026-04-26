"use client";

import { useAuthStore } from "@/stores/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await parseJsonSafe(res);
    const msg =
      typeof body === "object" && body && "message" in body && typeof (body as any).message === "string"
        ? (body as any).message
        : "Request failed";
    throw new ApiError(msg, res.status, body);
  }

  return (await parseJsonSafe(res)) as T;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    role: "patient" | "doctor" | "admin" | "clinic_admin" | "clinic_staff";
    clinicId?: string | null;
  };
}

export async function login(params: { email: string; password: string }): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export interface BookAppointmentResponse {
  appointmentId: string;
  tokenId: string;
  tokenNumber: number;
  doctorId: string;
  apptDate: string;
  apptTime: string;
}

export async function bookAppointment(params: {
  clinicId?: string;
  doctorId: string;
  apptDate: string;
  apptTime: string;
}): Promise<BookAppointmentResponse> {
  return apiFetch<BookAppointmentResponse>("/api/queue/book", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export interface DoctorListItem {
  id: string;
  name: string;
  speciality: string | null;
  clinicName: string;
}

export async function listDoctorsForBooking(): Promise<DoctorListItem[]> {
  return apiFetch<DoctorListItem[]>("/api/doctors");
}

export async function getBookedTimes(params: {
  clinicId?: string;
  doctorId: string;
  apptDate: string;
}): Promise<string[]> {
  const q = new URLSearchParams({
    doctorId: params.doctorId,
    apptDate: params.apptDate,
    ...(params.clinicId ? { clinicId: params.clinicId } : {}),
  });
  return apiFetch<string[]>(`/api/queue/booked-times?${q.toString()}`);
}

export type ClinicDoctorForDate = {
  id: string;
  name: string;
  speciality: string | null;
};

export async function listClinicDoctorsForDate(params: {
  clinicId: string;
  date: string;
}): Promise<ClinicDoctorForDate[]> {
  const q = new URLSearchParams({ date: params.date });
  return apiFetch<ClinicDoctorForDate[]>(`/api/clinics/${params.clinicId}/doctors?${q.toString()}`);
}

export type ClinicDoctorAvailability = {
  date: string;
  clinicId: string;
  doctorId: string;
  window: { from: string; to: string } | null;
  slots: string[];
  disabled: string[];
  reason?: string;
};

export async function getClinicDoctorAvailability(params: {
  clinicId: string;
  doctorId: string;
  date: string;
}): Promise<ClinicDoctorAvailability> {
  const q = new URLSearchParams({ date: params.date });
  return apiFetch<ClinicDoctorAvailability>(
    `/api/clinics/${params.clinicId}/doctors/${params.doctorId}/availability?${q.toString()}`,
  );
}

export interface PatientOpenVisit {
  tokenId: string;
  tokenNumber: number;
  doctorId: string;
  appointmentId: string;
  status: "waiting" | "active";
  apptDate: string;
  apptTime: string;
}

/** Today’s visit in `waiting` or `active`; `null` when patient may book again. */
export async function getPatientOpenVisit(): Promise<PatientOpenVisit | null> {
  return apiFetch<PatientOpenVisit | null>("/api/queue/patient/open-visit");
}

export interface ETAResponse {
  status?: string;
  tokensAhead?: number;
  waitAtClinicMin?: number;
  travelTimeMin?: number;
  leaveHomeInMin?: number;
  shouldLeaveNow?: boolean;
  avgConsultMin?: number;
}

export async function getETA(params: {
  tokenId: string;
  lat: number;
  lng: number;
}): Promise<ETAResponse> {
  const q = new URLSearchParams({
    tokenId: params.tokenId,
    lat: String(params.lat),
    lng: String(params.lng),
  });
  return apiFetch<ETAResponse>(`/api/queue/eta?${q.toString()}`);
}

export interface QueuePatient {
  id: string;
  name: string;
  phone?: string | null;
}

export interface QueueAppointment {
  id: string;
  apptDate: string;
  apptTime: string;
  status: string;
}

export interface QueueTokenRow {
  id: string;
  tokenNumber: number;
  status: string;
  patientId: string;
  doctorId: string;
  appointmentId?: string | null;
  patient?: QueuePatient;
  appointment?: QueueAppointment | null;
}

export interface DoctorQueueToday {
  doctorId: string;
  waiting: QueueTokenRow[];
  active: QueueTokenRow | null;
  completed: QueueTokenRow[];
  skipped: QueueTokenRow[];
}

export async function getDoctorQueueToday(): Promise<DoctorQueueToday> {
  return apiFetch<DoctorQueueToday>("/api/queue/today");
}

export type DoctorAvailability = {
  availableDays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"> | null;
  availableFrom: string | null; // HH:MM
  availableTo: string | null; // HH:MM
};

export async function getMyDoctorAvailability(): Promise<DoctorAvailability & { id: string }> {
  return apiFetch("/api/doctors/me");
}

export async function updateMyDoctorAvailability(params: {
  availableDays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  availableFrom: string;
  availableTo: string;
}): Promise<DoctorAvailability & { id: string }> {
  return apiFetch("/api/doctors/me/availability", {
    method: "PUT",
    body: JSON.stringify(params),
  });
}

export type ClinicDirectoryItem = {
  id: string;
  name: string;
  address: string | null;
};

export async function listClinics(): Promise<ClinicDirectoryItem[]> {
  return apiFetch<ClinicDirectoryItem[]>("/api/clinics");
}

export type DoctorClinicSchedule = {
  id: string;
  clinicId: string;
  clinicName: string;
  availableDays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  availableFrom: string;
  availableTo: string;
};

export async function listMyClinicSchedules(): Promise<DoctorClinicSchedule[]> {
  return apiFetch<DoctorClinicSchedule[]>("/api/doctors/me/clinic-schedules");
}

export async function upsertMyClinicSchedule(params: {
  clinicId: string;
  availableDays: DoctorClinicSchedule["availableDays"];
  availableFrom: string;
  availableTo: string;
}): Promise<{
  clinicId: string;
  availableDays: DoctorClinicSchedule["availableDays"];
  availableFrom: string;
  availableTo: string;
}> {
  return apiFetch("/api/doctors/me/clinic-schedules", {
    method: "PUT",
    body: JSON.stringify(params),
  });
}

export async function deleteMyClinicSchedule(clinicId: string): Promise<{ ok: true }> {
  const q = new URLSearchParams({ clinicId });
  return apiFetch(`/api/doctors/me/clinic-schedules?${q.toString()}`, { method: "DELETE" });
}

export type ClinicScheduleExceptionRow = {
  id: string;
  clinicId: string;
  doctorId: string | null;
  date: string; // YYYY-MM-DD
  type: "closed" | "open";
  fromTime: string | null; // HH:MM
  toTime: string | null; // HH:MM
  note: string | null;
};

export async function listMyClinicExceptions(params: {
  clinicId: string;
  from: string;
  to: string;
}): Promise<ClinicScheduleExceptionRow[]> {
  const q = new URLSearchParams({ clinicId: params.clinicId, from: params.from, to: params.to });
  return apiFetch<ClinicScheduleExceptionRow[]>(`/api/doctors/me/clinic-exceptions?${q.toString()}`);
}

export async function createMyClinicException(params: {
  clinicId: string;
  scope: "clinic" | "doctor";
  date: string;
  type: "closed" | "open";
  fromTime?: string | null;
  toTime?: string | null;
  note?: string | null;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/doctors/me/clinic-exceptions`, {
    method: "POST",
    body: JSON.stringify({
      clinicId: params.clinicId,
      scope: params.scope,
      date: params.date,
      type: params.type,
      fromTime: params.fromTime ?? null,
      toTime: params.toTime ?? null,
      note: params.note ?? null,
    }),
  });
}

export async function updateMyClinicException(params: {
  id: string;
  clinicId: string;
  scope: "clinic" | "doctor";
  date: string;
  type: "closed" | "open";
  fromTime?: string | null;
  toTime?: string | null;
  note?: string | null;
}): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/doctors/me/clinic-exceptions/${params.id}`, {
    method: "PUT",
    body: JSON.stringify({
      clinicId: params.clinicId,
      scope: params.scope,
      date: params.date,
      type: params.type,
      fromTime: params.fromTime ?? null,
      toTime: params.toTime ?? null,
      note: params.note ?? null,
    }),
  });
}

export async function deleteMyClinicException(params: { id: string; clinicId: string }): Promise<{ ok: true }> {
  const q = new URLSearchParams({ clinicId: params.clinicId });
  return apiFetch<{ ok: true }>(`/api/doctors/me/clinic-exceptions/${params.id}?${q.toString()}`, {
    method: "DELETE",
  });
}

export type ClinicAdminClinic = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
};

export async function clinicAdminGetMe(): Promise<ClinicAdminClinic> {
  return apiFetch<ClinicAdminClinic>("/api/clinic-admin/me");
}

export async function clinicAdminUpdateMe(params: { name: string; address?: string | null }): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/clinic-admin/me", {
    method: "PUT",
    body: JSON.stringify({ name: params.name, address: params.address ?? null }),
  });
}

export type ClinicAdminDoctorRow = {
  id: string;
  name: string;
  speciality: string | null;
  isActive: boolean;
};

export async function clinicAdminListDoctors(): Promise<ClinicAdminDoctorRow[]> {
  return apiFetch<ClinicAdminDoctorRow[]>("/api/clinic-admin/me/doctors");
}

export type ClinicAdminAppointmentRow = {
  id: string;
  apptDate: string;
  apptTime: string;
  status: string;
  doctor: { id: string; name: string };
  patient: { id: string; name: string };
};

export async function clinicAdminListAppointments(params: { from: string; to: string }): Promise<ClinicAdminAppointmentRow[]> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  return apiFetch<ClinicAdminAppointmentRow[]>(`/api/clinic-admin/me/appointments?${q.toString()}`);
}

export async function clinicAdminListExceptions(params: { from: string; to: string }): Promise<ClinicScheduleExceptionRow[]> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  return apiFetch<ClinicScheduleExceptionRow[]>(`/api/clinic-admin/me/exceptions?${q.toString()}`);
}

export async function clinicAdminCreateException(params: {
  date: string;
  type: "closed" | "open";
  doctorId?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
  note?: string | null;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/clinic-admin/me/exceptions`, {
    method: "POST",
    body: JSON.stringify({
      date: params.date,
      type: params.type,
      doctorId: params.doctorId ?? null,
      fromTime: params.fromTime ?? null,
      toTime: params.toTime ?? null,
      note: params.note ?? null,
    }),
  });
}

export async function clinicAdminUpdateException(params: {
  id: string;
  date: string;
  type: "closed" | "open";
  doctorId?: string | null;
  fromTime?: string | null;
  toTime?: string | null;
  note?: string | null;
}): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/clinic-admin/me/exceptions/${params.id}`, {
    method: "PUT",
    body: JSON.stringify({
      date: params.date,
      type: params.type,
      doctorId: params.doctorId ?? null,
      fromTime: params.fromTime ?? null,
      toTime: params.toTime ?? null,
      note: params.note ?? null,
    }),
  });
}

export async function clinicAdminLinkMyClinic(params: { clinicId: string }): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/clinic-admin/me/link`, {
    method: "POST",
    body: JSON.stringify({ clinicId: params.clinicId }),
  });
}

export type ClinicAdminDoctorSchedule = {
  doctorId: string;
  clinicId: string;
  schedule: null | {
    id: string;
    availableDays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
    availableFrom: string;
    availableTo: string;
  };
};

export async function clinicAdminGetDoctorSchedule(doctorId: string): Promise<ClinicAdminDoctorSchedule> {
  return apiFetch<ClinicAdminDoctorSchedule>(`/api/clinic-admin/me/doctors/${doctorId}/schedule`);
}

export async function clinicAdminUpsertDoctorSchedule(params: {
  doctorId: string;
  availableDays: NonNullable<ClinicAdminDoctorSchedule["schedule"]>["availableDays"];
  availableFrom: string;
  availableTo: string;
}): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/clinic-admin/me/doctors/${params.doctorId}/schedule`, {
    method: "PUT",
    body: JSON.stringify({
      availableDays: params.availableDays,
      availableFrom: params.availableFrom,
      availableTo: params.availableTo,
    }),
  });
}

export async function queueStartToken(tokenId: string): Promise<{ message: string }> {
  return apiFetch("/api/queue/start", {
    method: "POST",
    body: JSON.stringify({ tokenId }),
  });
}

export async function queueEndToken(tokenId: string): Promise<{ message: string }> {
  return apiFetch("/api/queue/end", {
    method: "POST",
    body: JSON.stringify({ tokenId }),
  });
}

export async function queueSkipToken(tokenId: string): Promise<{ message: string }> {
  return apiFetch("/api/queue/skip", {
    method: "POST",
    body: JSON.stringify({ tokenId }),
  });
}

