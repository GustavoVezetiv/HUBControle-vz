import type { Category, CreditCard, Person, Subscription, SubscriptionMember, SubscriptionOccurrence } from "@/lib/supabase/types";

export type SubscriptionRow = Subscription;
export type SubscriptionMemberRow = SubscriptionMember;
export type SubscriptionOccurrenceRow = SubscriptionOccurrence;
export type SubscriptionCard = Pick<CreditCard, "id" | "name" | "issuer">;
export type SubscriptionCategory = Pick<Category, "id" | "name" | "type" | "color" | "icon" | "scopes">;
export type SubscriptionPerson = Pick<Person, "id" | "name">;

export type SubscriptionMemberValue = {
  person_id: string;
  share_amount: string;
};

export type SubscriptionFormValues = {
  credit_card_id: string;
  category_id: string;
  name: string;
  description: string;
  amount: string;
  billing_day: string;
  start_date: string;
  end_date: string;
  status: "active" | "paused" | "cancelled";
  notes: string;
  members: SubscriptionMemberValue[];
};

export const emptySubscriptionForm: SubscriptionFormValues = {
  credit_card_id: "",
  category_id: "",
  name: "",
  description: "",
  amount: "0",
  billing_day: "1",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  status: "active",
  notes: "",
  members: [],
};

export function subscriptionToFormValues(subscription: SubscriptionRow, members: SubscriptionMemberRow[]): SubscriptionFormValues {
  return {
    credit_card_id: subscription.credit_card_id,
    category_id: subscription.category_id ?? "",
    name: subscription.name,
    description: subscription.description ?? "",
    amount: String(subscription.amount),
    billing_day: String(subscription.billing_day),
    start_date: subscription.start_date,
    end_date: subscription.end_date ?? "",
    status: subscription.status,
    notes: subscription.notes ?? "",
    members: members.map((member) => ({ person_id: member.person_id, share_amount: String(member.share_amount) })),
  };
}
