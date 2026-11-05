"use client";

import { Badge } from "@geiger/ui/badge";
import { ACCOUNT_STATUS, PAYMENT_STATUS } from "../core/constants.js";

const ACCOUNT_BADGES = {
  [ACCOUNT_STATUS.ACTIVE]: { variant: "success", label: "Ready" },
  [ACCOUNT_STATUS.PENDING]: { variant: "info", label: "In review" },
  [ACCOUNT_STATUS.ACTION_REQUIRED]: { variant: "warning", label: "Action needed" },
  [ACCOUNT_STATUS.REJECTED]: { variant: "danger", label: "Rejected" },
  [ACCOUNT_STATUS.DISCONNECTED]: { variant: "neutral", label: "Not connected" },
  [ACCOUNT_STATUS.NOT_CONNECTED]: { variant: "neutral", label: "Not connected" },
};

const PAYMENT_BADGES = {
  [PAYMENT_STATUS.PENDING]: { variant: "neutral", label: "Pending" },
  [PAYMENT_STATUS.PROCESSING]: { variant: "info", label: "Processing" },
  [PAYMENT_STATUS.SUCCEEDED]: { variant: "success", label: "Paid" },
  [PAYMENT_STATUS.FAILED]: { variant: "danger", label: "Failed" },
  [PAYMENT_STATUS.EXPIRED]: { variant: "neutral", label: "Expired" },
  [PAYMENT_STATUS.REFUNDED]: { variant: "neutral", label: "Refunded" },
  [PAYMENT_STATUS.PARTIALLY_REFUNDED]: { variant: "warning", label: "Partly refunded" },
  [PAYMENT_STATUS.DISPUTED]: { variant: "danger", label: "Disputed" },
};

export function AccountStatusBadge({ status, className }) {
  const badge = ACCOUNT_BADGES[status] || ACCOUNT_BADGES[ACCOUNT_STATUS.NOT_CONNECTED];
  return (
    <Badge variant={badge.variant} className={className}>
      {badge.label}
    </Badge>
  );
}

export function PaymentStatusBadge({ status, className }) {
  const badge = PAYMENT_BADGES[status] || PAYMENT_BADGES[PAYMENT_STATUS.PENDING];
  return (
    <Badge variant={badge.variant} className={className}>
      {badge.label}
    </Badge>
  );
}
