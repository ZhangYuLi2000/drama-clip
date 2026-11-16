import { useState } from 'react'
import type { ReactElement } from 'react'
import { IconFolderOpen } from './icons'
import { Button } from 'antd'
import { toast } from './store'

export default function DirField({
  value,
  onChange
}: {
  value: string
  onChange: (next: string) => void
}): ReactElement {
  const [busy, setBusy] = useState(false)
  const pick = (): void => {
    const api = window.electronAPI
    if (!api) {
      toast('当前环境没有目录选择器', 'info')
      return
    }
    setBusy(true)
    void api
      .invoke('select-directory')
      .then((picked) => {
        if (typeof picked === 'string' && picked) onChange(picked)
      })
      .catch(() => toast('没能打开目录选择器', 'info'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="dw-dir">
      <span className="dw-dir-path" title={value}>
        {value || '未选择目录'}
      </span>
      <Button icon={<IconFolderOpen />} loading={busy} onClick={pick}>
        选择目录
      </Button>
    </div>
  )
}
