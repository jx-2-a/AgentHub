import { useEffect, useState } from 'react';
import type { FieldSpec } from '../../types';
import { useChatStore } from '../../stores/chatStore';

/** 前提条件表单(SSH 凭证/选实验等)。对等旧规则:不可点击遮罩关闭。 */
export function RequirementModal() {
  const pending = useChatStore((s) => s.pendingRequirement);
  const sendAnswer = useChatStore((s) => s.sendRequirementAnswer);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pending) {
      const v: Record<string, string> = {};
      for (const f of pending.fields) {
        v[f.key] = f.value !== undefined ? String(f.value) : '';
      }
      setValues(v);
    }
  }, [pending]);

  if (!pending) return null;

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const submit = () => sendAnswer(pending.id, values);

  return (
    <div className="modal">
      <div className="modal-box requirement-box">
        <h3>前提条件</h3>
        <p className="req-reason">{pending.reason}</p>
        <form
          id="req-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {pending.fields.map((f) => (
            <RequirementField key={f.key} field={f} value={values[f.key] ?? ''} onChange={set} />
          ))}
          <div className="modal-actions">
            <button type="button" onClick={() => sendAnswer(pending.id, null)}>
              取消
            </button>
            <button type="submit" className="primary">
              提交
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RequirementField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  // 选择列表:下拉
  if (field.type === 'select') {
    return (
      <label>
        {field.label || field.key}
        <select value={value} onChange={(e) => onChange(field.key, e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label || o.value}
            </option>
          ))}
        </select>
      </label>
    );
  }
  // 多行字符输入
  if (field.type === 'textarea') {
    return (
      <label>
        {field.label || field.key}
        <textarea
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          rows={3}
        />
      </label>
    );
  }
  // 单行字符输入(text/password/otp/number)
  return (
    <label>
      {field.label || field.key}
      <input
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
        inputMode={field.type === 'otp' ? 'numeric' : undefined}
        maxLength={field.type === 'otp' ? 6 : undefined}
        placeholder={field.placeholder ?? (field.type === 'otp' ? '6 位动态码' : undefined)}
      />
    </label>
  );
}
