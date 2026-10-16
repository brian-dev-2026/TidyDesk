import type { TidyApi } from '@shared/types'

declare global {
  interface Window {
    tidy: TidyApi
  }
}

export {}
