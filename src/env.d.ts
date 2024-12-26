/// <reference path="../.astro/types.d.ts" />

declare module '*.svg' {
  const content: string;
  export default content;
}