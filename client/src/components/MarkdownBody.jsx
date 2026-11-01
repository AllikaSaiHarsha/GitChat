import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CheckIcon, CopyIcon } from '@primer/octicons-react';
import { copyText } from '../lib/clipboard.js';

// Plain-text extraction from an hast subtree (used by the copy button).
function extractText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  if (Array.isArray(node.children)) return node.children.map(extractText).join('');
  return '';
}

// Language from a fenced block: pre > code.className = ["hljs", "language-js"].
function findLanguage(node) {
  const code = Array.isArray(node?.children)
    ? node.children.find((c) => c.tagName === 'code')
    : null;
  const cls = code?.properties?.className;
  const list = Array.isArray(cls) ? cls : cls ? [cls] : [];
  const lang = list.find((c) => typeof c === 'string' && c.startsWith('language-'));
  return lang ? lang.slice('language-'.length) : '';
}

// Fenced code block: language label, copy button, horizontal scroll.
function CodeBlock({ node, children }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(node);
  const lang = findLanguage(node);

  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-block-lang">{lang || 'code'}</span>
        <button
          type="button"
          className="code-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={copy}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components = {
  pre: CodeBlock,
  // Links open in a new tab; markdown HTML is escaped by react-markdown by default.
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
};

// Renders message text as GitHub-flavored markdown with syntax highlighting.
export default function MarkdownBody({ text }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
