"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-text-secondary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_strong]:text-text-primary [&_a]:text-neon-blue-400">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
