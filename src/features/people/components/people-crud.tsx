"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import {
  ActionButton,
  BooleanBadge,
  CrudFeedback,
  FieldShell,
  inputClassName,
  Modal,
  QuickEditInput,
  QuickEditSelect,
  TitleButton,
} from "@/features/shared/crud-ui";
import { peopleTypeOptions, optionLabel } from "@/features/shared/options";
import { getQuickTableEditPreference } from "@/features/shared/quick-edit";
import type { FeedbackState } from "@/features/shared/types";
import {
  createPerson,
  deletePerson,
  listPeople,
  updatePerson,
} from "@/features/people/queries";
import {
  emptyPersonForm,
  personToFormValues,
  type PersonFormValues,
  type PersonRow,
} from "@/features/people/types";
import { createClient } from "@/lib/supabase/client";

type ModalState =
  | { mode: "create"; person: null }
  | { mode: "edit"; person: PersonRow }
  | null;

export function PeopleCrud() {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [allowQuickTableEdit, setAllowQuickTableEdit] = useState(false);

  const filteredPeople = useMemo(() => {
    const needle = search.trim().toLowerCase();

    if (!needle) {
      return people;
    }

    return people.filter((person) => person.name.toLowerCase().includes(needle));
  }, [people, search]);

  async function loadPeople() {
    setLoading(true);
    setFeedback(null);

    try {
      const client = createClient();
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();

      if (userError || !user) {
        setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
        return;
      }

      setUserId(user.id);

      const [{ data, error }, quickEdit] = await Promise.all([
        listPeople(client),
        getQuickTableEditPreference(client, user.id),
      ]);

      if (error) {
        setFeedback({ type: "error", message: error.message });
        return;
      }

      setPeople(data ?? []);
      setAllowQuickTableEdit(quickEdit);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Erro ao carregar pessoas.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPeople();
  }, []);

  async function handleSubmit(values: PersonFormValues) {
    if (!values.name.trim()) {
      setFeedback({ type: "error", message: "Informe o nome da pessoa." });
      return;
    }

    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const client = createClient();
      const result =
        modal?.mode === "edit"
          ? await updatePerson(client, modal.person.id, values)
          : await createPerson(client, userId, values);

      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }

      setFeedback({
        type: "success",
        message: modal?.mode === "edit" ? "Pessoa atualizada." : "Pessoa criada.",
      });
      setModal(null);
      await loadPeople();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(person: PersonRow) {
    const confirmed = window.confirm(`Excluir ${person.name}?`);

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    const { error } = await deletePerson(createClient(), person.id);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      return;
    }

    setFeedback({ type: "success", message: "Pessoa excluída." });
    await loadPeople();
  }

  async function handleQuickUpdate(person: PersonRow, patch: Partial<PersonFormValues>) {
    const result = await updatePerson(createClient(), person.id, { ...personToFormValues(person), ...patch });

    if (result.error) {
      console.error("Erro técnico ao atualizar pessoa:", result.error);
      setFeedback({ type: "error", message: "Não foi possível atualizar a pessoa." });
      return;
    }

    setFeedback({ type: "success", message: "Pessoa atualizada." });
    await loadPeople();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Responsáveis"
        title="Pessoas"
        description="Cadastre familiares, amigos, clientes e pagadores ligados a despesas ou entradas."
        action={<ActionButton onClick={() => setModal({ mode: "create", person: null })}>Nova pessoa</ActionButton>}
      />

      <CrudFeedback feedback={feedback} />

      <SectionCard title="Busca" description="Encontre rapidamente uma pessoa pelo nome.">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome"
          className={inputClassName}
        />
      </SectionCard>

      <SectionCard title="Pessoas cadastradas">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando pessoas...</p>
        ) : people.length === 0 ? (
          <EmptyState
            title="Nenhuma pessoa cadastrada"
            description="Crie pessoas para associar contas, receitas e futuros reembolsos."
            actionLabel="Use o botão Nova pessoa"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Telefone</th>
                  <th className="px-4 py-3">Ativo</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {filteredPeople.map((person) => (
                  <tr key={person.id}>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={person.name} onCommit={(value) => void handleQuickUpdate(person, { name: value })} />
                      ) : (
                        <TitleButton onClick={() => setModal({ mode: "edit", person })}>
                          {person.name}
                        </TitleButton>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect value={person.relationship_type} options={peopleTypeOptions} onCommit={(value) => void handleQuickUpdate(person, { relationship_type: value as PersonFormValues["relationship_type"] })} />
                      ) : optionLabel(peopleTypeOptions, person.relationship_type)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={person.email ?? ""} onCommit={(value) => void handleQuickUpdate(person, { email: value })} />
                      ) : person.email ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {allowQuickTableEdit ? (
                        <QuickEditInput value={person.phone ?? ""} onCommit={(value) => void handleQuickUpdate(person, { phone: value })} />
                      ) : person.phone ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {allowQuickTableEdit ? (
                        <QuickEditSelect
                          value={String(person.is_active)}
                          options={[{ value: "true", label: "Ativo" }, { value: "false", label: "Inativo" }]}
                          onCommit={(value) => void handleQuickUpdate(person, { is_active: value === "true" })}
                        />
                      ) : <BooleanBadge value={person.is_active} />}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <ActionButton
                          variant="secondary"
                          onClick={() => setModal({ mode: "edit", person })}
                        >
                          Editar
                        </ActionButton>
                        <ActionButton variant="danger" onClick={() => void handleDelete(person)}>
                          Excluir
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {modal ? (
        <PersonModal
          modal={modal}
          saving={saving}
          onSubmit={(values) => void handleSubmit(values)}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

function PersonModal({
  modal,
  saving,
  onSubmit,
  onClose,
}: {
  modal: ModalState;
  saving: boolean;
  onSubmit: (values: PersonFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<PersonFormValues>(
    modal?.mode === "edit" ? personToFormValues(modal.person) : emptyPersonForm,
  );

  return (
    <Modal
      title={modal?.mode === "edit" ? "Editar pessoa" : "Nova pessoa"}
      description="Pessoas são registros seus. Elas não recebem login no MVP."
      onClose={onClose}
    >
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <FieldShell label="Nome">
          <input
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            className={inputClassName}
            required
          />
        </FieldShell>

        <FieldShell label="Tipo">
          <select
            value={values.relationship_type}
            onChange={(event) =>
              setValues({ ...values, relationship_type: event.target.value as PersonFormValues["relationship_type"] })
            }
            className={inputClassName}
          >
            {peopleTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>

        <FieldShell label="E-mail">
          <input
            value={values.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
            type="email"
            className={inputClassName}
          />
        </FieldShell>

        <FieldShell label="Telefone">
          <input
            value={values.phone}
            onChange={(event) => setValues({ ...values, phone: event.target.value })}
            className={inputClassName}
          />
        </FieldShell>

        <FieldShell label="Status">
          <select
            value={String(values.is_active)}
            onChange={(event) => setValues({ ...values, is_active: event.target.value === "true" })}
            className={inputClassName}
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </select>
        </FieldShell>

        <div className="md:col-span-2">
          <FieldShell label="Notas">
            <textarea
              value={values.notes}
              onChange={(event) => setValues({ ...values, notes: event.target.value })}
              className={inputClassName}
              rows={4}
            />
          </FieldShell>
        </div>

        <div className="flex justify-end gap-2 md:col-span-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </ActionButton>
          <ActionButton type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </ActionButton>
        </div>
      </form>
    </Modal>
  );
}
