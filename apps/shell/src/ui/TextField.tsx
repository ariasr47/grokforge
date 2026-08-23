import {
  TextField as AriaTextField,
  Input,
  Label,
} from "react-aria-components";

export function TextField({
  id,
  label,
  value,
  onChange,
  list,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  list?: string;
}) {
  return (
    <AriaTextField className="field" value={value} onChange={onChange}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} list={list} />
    </AriaTextField>
  );
}
