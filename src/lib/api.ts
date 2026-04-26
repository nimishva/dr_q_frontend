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
    throw new ApiError("Request failed", res.status, body);
  }

  return (await parseJsonSafe(res)) as T;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; role: "patient" | "doctor" | "admin" };
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

