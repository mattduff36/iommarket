import { Alert } from "@/components/ui/alert";

interface FormErrorSummaryProps {
  messages: string[];
  title?: string;
}

export function FormErrorSummary({
  messages,
  title = "Please fix the following:",
}: FormErrorSummaryProps) {
  if (messages.length === 0) return null;

  if (messages.length === 1) {
    return (
      <Alert status="error">
        <p>{messages[0]}</p>
      </Alert>
    );
  }

  return (
    <Alert status="error">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </Alert>
  );
}
