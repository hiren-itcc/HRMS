import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders announcement bodies.
 *
 * Markdown is the storage format and raw HTML is NOT enabled
 * (no rehype-raw), so an author cannot inject scripts into a post every
 * employee reads — the reason this is markdown rather than a WYSIWYG that
 * stores HTML.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="font-semibold text-base">{children}</h3>,
          h2: ({ children }) => <h4 className="font-semibold text-sm">{children}</h4>,
          h3: ({ children }) => <h5 className="font-medium text-sm">{children}</h5>,
          p: ({ children }) => <p className="text-foreground/90">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-primary/40 border-l-2 pl-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-4"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b px-2 py-1 font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
