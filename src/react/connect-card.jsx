"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleAlert, CreditCard, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@geiger/ui/badge";
import { Button } from "@geiger/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@geiger/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@geiger/ui/select";
import { ACCOUNT_STATUS, CONNECT_COUNTRIES } from "../core/constants.js";
import { AccountStatusBadge } from "./status-badges.jsx";

const COPY = {
  [ACCOUNT_STATUS.NOT_CONNECTED]:
    "Connect a Stripe account so sales from your Geiger apps pay out to your organization. Sign in with an existing Stripe login or create one.",
  [ACCOUNT_STATUS.ACTION_REQUIRED]: "Stripe needs a few more details before this organization can accept payments.",
  [ACCOUNT_STATUS.PENDING]: "Stripe is reviewing your details. This usually takes a few minutes.",
  [ACCOUNT_STATUS.ACTIVE]: "Payments from your Geiger apps go straight to this Stripe account.",
  [ACCOUNT_STATUS.REJECTED]: "Stripe couldn't verify this account. Open the Stripe Dashboard to see why.",
};

const formatDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function useBrowserCountry(defaultCountry) {
  const [country, setCountry] = useState(defaultCountry || "US");
  useEffect(() => {
    if (defaultCountry || typeof navigator === "undefined") return;
    try {
      const region = new Intl.Locale(navigator.language).maximize().region;
      if (CONNECT_COUNTRIES.some((item) => item.code === region)) setCountry(region);
    } catch {}
  }, [defaultCountry]);
  return [country, setCountry];
}

// Server Actions passed in return `{ url }`, an account summary, or `{ error: { message } }`.
export function StripeConnectCard({
  account,
  canManage = false,
  onConnect,
  onRefresh,
  onDisconnect,
  defaultCountry,
  className,
}) {
  const [current, setCurrent] = useState(account);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [country, setCountry] = useBrowserCountry(defaultCountry);

  useEffect(() => setCurrent(account), [account]);

  const status = current?.status || ACCOUNT_STATUS.NOT_CONNECTED;
  const connected = status !== ACCOUNT_STATUS.NOT_CONNECTED && status !== ACCOUNT_STATUS.DISCONNECTED;
  const busy = (name) => isPending && pendingAction === name;

  function run(name, action, onResult) {
    setError(null);
    setPendingAction(name);
    startTransition(async () => {
      try {
        const result = await action();
        if (result?.error) setError(result.error.message || "Something went wrong.");
        else onResult(result);
      } catch (err) {
        setError(err?.message || "Something went wrong.");
      }
    });
  }

  const connect = () =>
    run("connect", () => onConnect({ country }), (result) => {
      if (result?.url) window.location.assign(result.url);
    });
  const refresh = () => run("refresh", () => onRefresh(), (result) => result && setCurrent(result));
  const disconnect = () =>
    run("disconnect", () => onDisconnect(), (result) => {
      setConfirming(false);
      setCurrent(result || { status: ACCOUNT_STATUS.NOT_CONNECTED });
    });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          Stripe payments
        </CardTitle>
        <CardDescription>{COPY[status] || COPY[ACCOUNT_STATUS.NOT_CONNECTED]}</CardDescription>
        <CardAction className="flex items-center gap-1.5">
          {connected && current?.livemode === false ? <Badge variant="outline">Test mode</Badge> : null}
          <AccountStatusBadge status={status} />
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {connected ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
            <dt className="text-muted-foreground">Account</dt>
            <dd className="truncate">{current.displayName || current.stripeAccountId}</dd>
            {current.country ? (
              <>
                <dt className="text-muted-foreground">Country</dt>
                <dd>{CONNECT_COUNTRIES.find((item) => item.code === current.country)?.name || current.country}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Payouts</dt>
            <dd>{current.payoutsEnabled ? "Enabled" : "Not yet enabled"}</dd>
          </dl>
        ) : canManage ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Where is your business based? This can't be changed later.</p>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="w-full sm:w-64" aria-label="Business country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONNECT_COUNTRIES.map((item) => (
                  <SelectItem key={item.code} value={item.code}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-muted-foreground">Ask an organization owner to connect Stripe.</p>
        )}

        {current?.requirementsDue > 0 && status === ACCOUNT_STATUS.ACTIVE ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            Stripe needs more information
            {current.requirementsDeadline ? ` by ${formatDate(current.requirementsDeadline)}` : ""} to keep payments
            running.
          </p>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        {canManage && onConnect && (status === ACCOUNT_STATUS.NOT_CONNECTED ||
          status === ACCOUNT_STATUS.DISCONNECTED ||
          status === ACCOUNT_STATUS.ACTION_REQUIRED ||
          current?.requirementsDue > 0) ? (
          <Button size="sm" onClick={connect} disabled={isPending}>
            {busy("connect") ? <Loader2 className="animate-spin" /> : null}
            {connected ? "Continue setup" : "Connect Stripe"}
          </Button>
        ) : null}
        {connected ? (
          <Button size="sm" variant="outline" asChild>
            <a href={current.dashboardUrl} target="_blank" rel="noreferrer">
              Stripe Dashboard
              <ExternalLink />
            </a>
          </Button>
        ) : null}
        {connected && onRefresh ? (
          <Button size="sm" variant="ghost" onClick={refresh} disabled={isPending}>
            {busy("refresh") ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        ) : null}
        {connected && canManage && onDisconnect ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)} disabled={isPending}>
            Disconnect
          </Button>
        ) : null}
      </CardFooter>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Stripe?</DialogTitle>
            <DialogDescription>
              Your Geiger apps will stop taking payments for this organization. Past payments and your Stripe account
              stay as they are. To remove Geiger's access completely, also revoke it from your Stripe Dashboard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" size="sm" onClick={disconnect} disabled={isPending}>
              {busy("disconnect") ? <Loader2 className="animate-spin" /> : null}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
