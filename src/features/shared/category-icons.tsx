"use client";

import {
  Banknote,
  BookOpen,
  BriefcaseBusiness,
  BusFront,
  Car,
  CircleEllipsis,
  Clapperboard,
  CreditCard,
  Gamepad2,
  GraduationCap,
  HandCoins,
  HeartPulse,
  Home,
  House,
  Laptop,
  Landmark,
  PawPrint,
  Plane,
  ReceiptText,
  ShoppingBasket,
  Shirt,
  Soup,
  Wrench,
  Wifi,
  Zap,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type CategoryIconOption = {
  value: string;
  label: string;
  Icon: LucideIcon;
};

export const categoryIconOptions: CategoryIconOption[] = [
  { value: "casa", label: "Casa", Icon: Home },
  { value: "moradia", label: "Moradia", Icon: House },
  { value: "carro", label: "Carro", Icon: Car },
  { value: "transporte", label: "Transporte", Icon: BusFront },
  { value: "cartao", label: "Cartão", Icon: CreditCard },
  { value: "comida", label: "Comida", Icon: Soup },
  { value: "mercado", label: "Mercado", Icon: ShoppingBasket },
  { value: "saude", label: "Saúde", Icon: HeartPulse },
  { value: "estudo", label: "Estudo", Icon: GraduationCap },
  { value: "educacao", label: "Educação", Icon: BookOpen },
  { value: "trabalho", label: "Trabalho", Icon: BriefcaseBusiness },
  { value: "lazer", label: "Lazer", Icon: Clapperboard },
  { value: "assinatura", label: "Assinatura", Icon: ReceiptText },
  { value: "familia", label: "Família", Icon: UsersRound },
  { value: "viagem", label: "Viagem", Icon: Plane },
  { value: "tecnologia", label: "Tecnologia", Icon: Laptop },
  { value: "salario", label: "Salário", Icon: Banknote },
  { value: "reembolso", label: "Reembolso", Icon: HandCoins },
  { value: "financiamento", label: "Financiamento", Icon: Landmark },
  { value: "freelas", label: "Freelas", Icon: BriefcaseBusiness },
  { value: "pet", label: "Pet", Icon: PawPrint },
  { value: "roupas", label: "Roupas", Icon: Shirt },
  { value: "ferramentas", label: "Ferramentas", Icon: Wrench },
  { value: "jogos", label: "Jogos", Icon: Gamepad2 },
  { value: "energia", label: "Energia", Icon: Zap },
  { value: "internet", label: "Internet", Icon: Wifi },
  { value: "outros", label: "Outros", Icon: CircleEllipsis },
];

export function CategoryIcon({ value, className = "h-4 w-4" }: { value?: string | null; className?: string }) {
  const normalized = value?.trim();
  const option = categoryIconOptions.find((item) => item.value === normalized);

  if (option) {
    const Icon = option.Icon;
    return <Icon aria-hidden="true" className={className} strokeWidth={2} />;
  }

  if (normalized) {
    return <span aria-hidden="true" className="inline-flex min-w-4 justify-center text-sm leading-none">{normalized}</span>;
  }

  return null;
}
