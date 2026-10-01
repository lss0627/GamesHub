import { UiIcon } from '../../components/UiIcon';

export function UndoAction(props: { onConfirm: () => void }) {
  return (
    <button
      className="ghost-button"
      type="button"
      onClick={props.onConfirm}
      aria-label="撤销刚刚的修改"
    >
      <UiIcon name="undo" /> 撤销刚刚的修改
    </button>
  );
}
