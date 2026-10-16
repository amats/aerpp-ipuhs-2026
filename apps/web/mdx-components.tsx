import type { MDXComponents } from "mdx/types"

const components: MDXComponents = {} satisfies MDXComponents

export function useMDXComponents(): MDXComponents {
  return components
}
