"use client"

import { idbGet, idbSet } from "./idb"
import type { OfflineOrderPayload } from "@/lib/orders/create"

const KEY = "order-outbox"

export type OutboxStatus = "pending" | "error"

export interface OutboxEntry {
  id: string // = clientRequestId
  payload: OfflineOrderPayload
  status: OutboxStatus
  attempts: number
  lastError?: string
  queuedAt: string
}

async function readAll(): Promise<OutboxEntry[]> {
  return (await idbGet<OutboxEntry[]>(KEY)) || []
}

async function writeAll(entries: OutboxEntry[]): Promise<void> {
  await idbSet(KEY, entries)
}

/** Thêm 1 đơn vào hàng chờ. Trả về danh sách mới. */
export async function enqueueOrder(payload: OfflineOrderPayload): Promise<OutboxEntry[]> {
  const entries = await readAll()
  entries.push({
    id: payload.clientRequestId,
    payload,
    status: "pending",
    attempts: 0,
    queuedAt: payload.meta.createdAt,
  })
  await writeAll(entries)
  return entries
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  return readAll()
}

export async function countOutbox(): Promise<number> {
  return (await readAll()).length
}

export async function removeEntry(id: string): Promise<void> {
  const entries = await readAll()
  await writeAll(entries.filter((e) => e.id !== id))
}

export async function markEntry(
  id: string,
  patch: Partial<Pick<OutboxEntry, "status" | "lastError" | "attempts">>
): Promise<void> {
  const entries = await readAll()
  const next = entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
  await writeAll(next)
}
