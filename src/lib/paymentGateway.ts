/**
 * Payment-gateway helpers for the Gateway page. The platform uses an
 * admin-managed manual receiving-account flow (QRIS, bank, e-wallet, PayPal,
 * USDT) rather than an automated PSP — every order is a request an admin
 * approves. This module documents the supported methods and validates amounts.
 */
import { PAYMENT_METHOD_LABEL } from './paymentMethods'

export interface GatewaySummary {
  methods: { method: string; label: string }[]
  minOrderUsd: number
  maxOrderUsd: number
}

export const GATEWAY_MIN_ORDER_USD = 1
export const GATEWAY_MAX_ORDER_USD = 10_000

export function gatewaySummary(): GatewaySummary {
  const methods = Object.entries(PAYMENT_METHOD_LABEL).map(([method, label]) => ({ method, label }))
  return { methods, minOrderUsd: GATEWAY_MIN_ORDER_USD, maxOrderUsd: GATEWAY_MAX_ORDER_USD }
}

/** Validate an order amount before submitting a payment request. */
export function validateOrderAmount(amount: number): string | null {
  if (!Number.isFinite(amount)) return 'Enter a valid amount.'
  if (amount < GATEWAY_MIN_ORDER_USD) return `Orders start at $${GATEWAY_MIN_ORDER_USD}.`
  if (amount > GATEWAY_MAX_ORDER_USD) return `Orders are capped at $${GATEWAY_MAX_ORDER_USD.toLocaleString()} for manual review.`
  return null
}