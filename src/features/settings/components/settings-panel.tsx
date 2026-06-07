"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { getProfile, upsertProfile } from "@/features/settings/queries";
import {
  animationLevelOptions,
  borderStyleOptions,
  cardEffectOptions,
  categoryBadgeStyleOptions,
  contentWidthOptions,
  currencyOptions,
  interfaceDensityOptions,
  profileToFormValues,
  timezoneOptions,
  visualStyleOptions,
  type ProfileRow,
  type SettingsFormValues,
} from "@/features/settings/types";
import { ActionButton, CrudFeedback, FieldShell, inputClassName } from "@/features/shared/crud-ui";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

export function SettingsPanel() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [values, setValues] = useState<SettingsFormValues>(profileToFormValues(null));
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const client = createClient();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      setLoading(false);
      return;
    }

    setUserId(auth.user.id);
    setEmail(auth.user.email ?? null);
    const { data, error } = await getProfile(client, auth.user.id);
    if (error) {
      setFeedback({ type: "error", message: error.message });
    } else {
      setProfile(data);
      setValues(profileToFormValues(data));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }
    const monthStartDay = Number(values.month_start_day);
    if (!Number.isInteger(monthStartDay) || monthStartDay < 1 || monthStartDay > 28) {
      setFeedback({ type: "error", message: "O dia inicial do mês deve estar entre 1 e 28." });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await upsertProfile(createClient(), userId, values);
      if (error) {
        console.error("Erro técnico ao salvar configurações:", error);
        setFeedback({ type: "error", message: error.message });
        return;
      }
      setProfile(data);
      setValues(profileToFormValues(data));
      setFeedback({ type: "success", message: "Configurações salvas." });
      router.refresh();
    } catch (error) {
      console.error("Erro técnico ao salvar configurações:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar as configurações." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Preferências"
        title="Configurações"
        description="Ajustes básicos do perfil e do comportamento financeiro do app."
      />
      <CrudFeedback feedback={feedback} />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Conta" value={email ?? "-"} helper="Email autenticado no Supabase." tone="info" />
        <StatCard label="Moeda" value={profile?.currency ?? values.currency} helper="Usada nas telas financeiras." tone="success" />
        <StatCard label="Fuso horário" value={profile?.timezone ?? values.timezone} helper="Base para datas e meses." tone="neutral" />
      </section>

      <SectionCard title="Perfil financeiro" description="Essas preferências ficam vinculadas ao seu usuário e protegidas por RLS.">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando configurações...</p>
        ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <FieldShell label="Nome de exibição"><input className={inputClassName} value={values.display_name} onChange={(event) => setValues({ ...values, display_name: event.target.value })} /></FieldShell>
              <FieldShell label="Email"><input className={inputClassName} value={email ?? ""} disabled /></FieldShell>
              <FieldShell label="Moeda"><select className={inputClassName} value={values.currency} onChange={(event) => setValues({ ...values, currency: event.target.value })}>{currencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
              <FieldShell label="Fuso horário"><select className={inputClassName} value={values.timezone} onChange={(event) => setValues({ ...values, timezone: event.target.value })}>{timezoneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FieldShell>
              <FieldShell label="Dia inicial do mês"><input min="1" max="28" type="number" className={inputClassName} value={values.month_start_day} onChange={(event) => setValues({ ...values, month_start_day: event.target.value })} /></FieldShell>
              <FieldShell label="Permitir edição rápida em tabelas">
                <select className={inputClassName} value={String(values.allow_quick_table_edit)} onChange={(event) => setValues({ ...values, allow_quick_table_edit: event.target.value === "true" })}>
                  <option value="false">Desativado</option>
                  <option value="true">Ativado</option>
                </select>
                <p className="mt-2 text-xs text-ink-600">Quando ativado, campos simples podem ser editados direto na tabela. Vínculos sensíveis continuam no modal.</p>
              </FieldShell>
            </div>

            <div className="rounded-lg border border-ink-950/10 bg-slate-50 p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-ink-950">Aparência do Hub</h3>
                <p className="mt-1 text-sm leading-6 text-ink-600">Ajuste visual leve para leitura diária. Não altera cálculos nem regras financeiras.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <FieldShell label="Estilo visual">
                  <select className={inputClassName} value={values.visual_style} onChange={(event) => setValues({ ...values, visual_style: event.target.value as SettingsFormValues["visual_style"] })}>
                    {visualStyleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <p className="mt-2 text-xs text-ink-600">{visualStyleOptions.find((option) => option.value === values.visual_style)?.description}</p>
                </FieldShell>
                <FieldShell label="Densidade da interface">
                  <select className={inputClassName} value={values.interface_density} onChange={(event) => setValues({ ...values, interface_density: event.target.value as SettingsFormValues["interface_density"] })}>
                    {interfaceDensityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FieldShell>
                <FieldShell label="Estilo dos badges de categoria">
                  <select className={inputClassName} value={values.category_badge_style} onChange={(event) => setValues({ ...values, category_badge_style: event.target.value as SettingsFormValues["category_badge_style"] })}>
                    {categoryBadgeStyleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FieldShell>
                <FieldShell label="Largura do conteúdo">
                  <select className={inputClassName} value={values.content_width} onChange={(event) => setValues({ ...values, content_width: event.target.value as SettingsFormValues["content_width"] })}>
                    {contentWidthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <p className="mt-2 text-xs text-ink-600">{contentWidthOptions.find((option) => option.value === values.content_width)?.description}</p>
                </FieldShell>
                <FieldShell label="Animações">
                  <select className={inputClassName} value={values.animation_level} onChange={(event) => setValues({ ...values, animation_level: event.target.value as SettingsFormValues["animation_level"] })}>
                    {animationLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <p className="mt-2 text-xs text-ink-600">{animationLevelOptions.find((option) => option.value === values.animation_level)?.description}</p>
                </FieldShell>
                <FieldShell label="Efeito dos cards">
                  <select className={inputClassName} value={values.card_effect} onChange={(event) => setValues({ ...values, card_effect: event.target.value as SettingsFormValues["card_effect"] })}>
                    {cardEffectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FieldShell>
                <FieldShell label="Bordas">
                  <select className={inputClassName} value={values.border_style} onChange={(event) => setValues({ ...values, border_style: event.target.value as SettingsFormValues["border_style"], surface_radius: event.target.value as SettingsFormValues["surface_radius"] })}>
                    {borderStyleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FieldShell>
              </div>
              <VisualPreview values={values} />
            </div>

            <div className="flex items-end justify-end"><ActionButton type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar configurações"}</ActionButton></div>
          </form>
        )}
      </SectionCard>

      <SectionCard title="Ambiente" description="Resumo técnico para beta privado.">
        <div className="grid gap-3 text-sm text-ink-700 md:grid-cols-2">
          <p><strong className="text-ink-950">Autenticação:</strong> Supabase Auth</p>
          <p><strong className="text-ink-950">Banco:</strong> Supabase PostgreSQL com RLS</p>
          <p><strong className="text-ink-950">Deploy:</strong> Vercel</p>
          <p><strong className="text-ink-950">Escopo:</strong> Web privado, sem integrações externas</p>
        </div>
      </SectionCard>
    </div>
  );
}

function VisualPreview({ values }: { values: SettingsFormValues }) {
  const visualLabel = visualStyleOptions.find((option) => option.value === values.visual_style)?.label ?? "Clássico";
  const densityLabel = interfaceDensityOptions.find((option) => option.value === values.interface_density)?.label ?? "Confortável";
  const badgeLabel = categoryBadgeStyleOptions.find((option) => option.value === values.category_badge_style)?.label ?? "Sólido";
  const widthLabel = contentWidthOptions.find((option) => option.value === values.content_width)?.label ?? "Padrão";
  const animationLabel = animationLevelOptions.find((option) => option.value === values.animation_level)?.label ?? "Suaves";
  const cardEffectLabel = cardEffectOptions.find((option) => option.value === values.card_effect)?.label ?? "Normal";
  const borderLabel = borderStyleOptions.find((option) => option.value === values.border_style)?.label ?? "Médias";

  return (
    <div
      className="hub-shell mt-4"
      data-visual-style={values.visual_style}
      data-density={values.interface_density}
      data-category-badge-style={values.category_badge_style}
      data-content-width={values.content_width}
      data-animation-level={values.animation_level}
      data-animations={values.animation_level === "off" ? "off" : "on"}
      data-card-effect={values.card_effect}
      data-interactive-cards={values.card_effect === "normal" ? "off" : "on"}
      data-card-glow={values.card_effect === "soft_glow" || values.card_effect === "strong_glow" ? "on" : "off"}
      data-border-style={values.border_style}
      data-surface-radius={values.border_style}
    >
      <div className="hub-card rounded-lg border border-ink-950/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-950">Prévia</p>
            <p className="mt-1 text-xs text-ink-600">{visualLabel} · {densityLabel} · {badgeLabel} · {widthLabel} · {animationLabel} · {cardEffectLabel} · {borderLabel}</p>
          </div>
          <span
            className="hub-category-badge inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{
              "--category-color": "#18b98f",
              "--category-text": "#0f172a",
            } as CSSProperties}
          >
            Categoria
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="hub-card rounded-lg border border-ink-950/10 bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-600">Card</p>
            <p className="mt-2 text-lg font-semibold text-ink-950">R$ 1.240</p>
            <p className="mt-1 text-xs text-ink-600">Hover, brilho e borda.</p>
          </div>
          <div className="rounded-md border border-ink-950/10 bg-white p-3">
            <button type="button" className="hub-action hub-action-primary rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white">Botão</button>
            <span className="hub-status-badge ml-2 inline-flex rounded-full bg-amberRisk-100 px-2.5 py-1 text-xs font-semibold text-amberRisk-500">Urgente</span>
          </div>
          <div className="overflow-hidden rounded-md border border-ink-950/10 bg-white">
            <table className="min-w-full text-left text-xs">
              <tbody>
                <tr className="border-b border-ink-950/10">
                  <td className="px-3 py-2 text-ink-600">Tabela</td>
                  <td className="px-3 py-2 font-semibold text-ink-950">Legível</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-ink-600">Status</td>
                  <td className="px-3 py-2"><span className="hub-status-badge rounded-full bg-mint-100 px-2 py-1 text-mint-600">Ok</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
