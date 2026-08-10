type FieldErrorProps = {
  id: string;
  errors?: string[];
};

export function FieldError({ id, errors }: FieldErrorProps) {
  if (!errors?.length) {
    return null;
  }

  return (
    <p id={id} className="mt-1 text-sm text-[var(--danger)]" role="alert">
      {errors[0]}
    </p>
  );
}
