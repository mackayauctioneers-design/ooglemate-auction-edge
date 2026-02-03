import { useAccounts, Account } from "@/hooks/useAccounts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

interface AccountSelectorProps {
  value: string;
  onChange: (accountId: string) => void;
  className?: string;
}

export function AccountSelector({ value, onChange, className }: AccountSelectorProps) {
  const { data: accounts, isLoading } = useAccounts();

  if (isLoading) {
    return (
      <div className="h-10 w-48 bg-muted animate-pulse rounded-md" />
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className || "w-[200px]"}>
        <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
        <SelectValue placeholder="Select account" />
      </SelectTrigger>
      <SelectContent>
        {accounts?.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
