"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { BusinessHours } from "@/lib/business-hours/schedule"

type Connector = { id: string; display_name: string; status: string }
type Saved = {
  connector_id: string
  enabled: boolean
  timezone: string
  windows: BusinessHours["windows"]
  holidays: string[]
  message: string
}
type Problem = { connector_id: string; conversation_id: string; state: string; created_at: string }

const initialWindows = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
  { weekday: 6, start: "09:00", end: "14:00" },
]

export function BusinessHoursSettings() {
  const t = useTranslations("BusinessHours")
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [saved, setSaved] = useState<Saved[]>([])
  const [problems, setProblems] = useState<Problem[]>([])
  const [connectorId, setConnectorId] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [timezone, setTimezone] = useState("America/Mexico_City")
  const [windows, setWindows] = useState<BusinessHours["windows"]>(initialWindows)
  const [holidays, setHolidays] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)

  function selectConnector(id: string, configurations: Saved[]) {
    const config = configurations.find((item) => item.connector_id === id)
    setConnectorId(id)
    setEnabled(config?.enabled ?? false)
    setTimezone(config?.timezone ?? "America/Mexico_City")
    setWindows(config?.windows ?? initialWindows)
    setHolidays(config?.holidays.join("\n") ?? "")
    setMessage(config?.message ?? "")
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch("/api/business-hours")
        if (!response.ok) throw new Error("load failed")
        const data: { connectors: Connector[]; settings: Saved[]; problems: Problem[] } = await response.json()
        if (!active) return
        setConnectors(data.connectors)
        setSaved(data.settings)
        setProblems(data.problems)
        selectConnector(data.connectors[0]?.id ?? "", data.settings)
      } catch {
        if (active) setLoadError(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  function updateWindow(weekday: number, patch: Partial<BusinessHours["windows"][number]>) {
    setWindows((current) => current.map((window) => window.weekday === weekday ? { ...window, ...patch } : window))
  }

  async function save() {
    setSaving(true)
    try {
      const config = {
        connectorId,
        enabled,
        timezone,
        windows,
        holidays: holidays.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
        message,
      }
      const response = await fetch("/api/business-hours", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      })
      if (!response.ok) throw new Error("save failed")
      setSaved((current) => [
        ...current.filter((item) => item.connector_id !== connectorId),
        { connector_id: connectorId, ...config },
      ])
      toast.success(t("saved"))
    } catch {
      toast.error(t("error"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {loading ? <p>{t("loading")}</p> : loadError ? <p role="alert">{t("error")}</p> : connectors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noConnectors")}</p>
      ) : (
        <>
          <label className="block space-y-1 text-sm">
            <span>{t("connector")}</span>
            <select className="w-full rounded-md border border-border bg-background p-2" value={connectorId} onChange={(event) => selectConnector(event.target.value, saved)}>
              {connectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.display_name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={enabled} onCheckedChange={setEnabled} /> {t("enabled")}
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("timezone")}</span>
            <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
          <div className="space-y-2">
            <p className="text-sm">{t("weekly")}</p>
            {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
              const window = windows.find((item) => item.weekday === weekday)
              return (
                <div key={weekday} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex w-36 items-center gap-2">
                    <Switch checked={Boolean(window)} onCheckedChange={(checked) => setWindows((current) => checked
                      ? [...current, { weekday, start: "09:00", end: "18:00" }]
                      : current.filter((item) => item.weekday !== weekday))} />
                    {t(`days.${weekday}`)}
                  </label>
                  {window && <>
                    <Input className="w-32" type="time" aria-label={t("opens")} value={window.start} onChange={(event) => updateWindow(weekday, { start: event.target.value })} />
                    <Input className="w-32" type="time" aria-label={t("closes")} value={window.end} onChange={(event) => updateWindow(weekday, { end: event.target.value })} />
                  </>}
                </div>
              )
            })}
          </div>
          <label className="block space-y-1 text-sm">
            <span>{t("holidays")}</span>
            <Textarea value={holidays} onChange={(event) => setHolidays(event.target.value)} placeholder="2026-12-25" />
            <span className="text-xs text-muted-foreground">{t("holidaysHelp")}</span>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t("message")}</span>
            <Textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4096} />
          </label>
          <p className="text-xs text-muted-foreground">{t("behavior")}</p>
          {problems.some((problem) => problem.connector_id === connectorId) && (
            <div role="alert" className="space-y-2 rounded-md border border-amber-500 p-3 text-sm">
              <p>{t("deliveryWarning")}</p>
              {problems.filter((problem) => problem.connector_id === connectorId).map((problem) => (
                <a className="block underline" key={`${problem.conversation_id}-${problem.created_at}`} href={`/inbox?c=${encodeURIComponent(problem.conversation_id)}`}>
                  {t("reviewConversation")} · {new Date(problem.created_at).toLocaleString()}
                </a>
              ))}
            </div>
          )}
          <Button onClick={save} disabled={saving || !connectorId}>{saving ? t("saving") : t("save")}</Button>
        </>
      )}
    </section>
  )
}
