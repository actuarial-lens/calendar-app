import type { CSSProperties } from 'react';
import type { Phase } from '../lib/animatedList';
import type { Task } from '../types';
import { REPEAT_LABEL } from '../lib/repeat';
import { SwipeRow, START_SUFFIX, type SwipeAction } from './SwipeRow';

interface Props {
  task: Task;
  phase: Phase;
  open: boolean;
  anyOpen: boolean;
  actions: SwipeAction[];
  startActions?: SwipeAction[];
  openKey: string | null;
  onOpenChange: (id: string | null) => void;
  onEdit: () => void;
  onLongPress?: (y: number) => void;
  dragStyle?: CSSProperties;
  lifted?: boolean;
}

export function TaskCard({ task, phase, open, anyOpen, actions, startActions, openKey, onOpenChange, onEdit, onLongPress, dragStyle, lifted }: Props) {
  return (
    <div className={'collapse ' + phase + (lifted ? ' lifted' : '')} data-task-id={task.id} style={dragStyle}>
      <div className="collapse-inner task-slot">
        <SwipeRow
          id={task.id}
          open={open}
          anyOpen={anyOpen}
          actions={actions}
          startActions={startActions}
          startOpen={openKey === task.id + START_SUFFIX}
          onOpenChange={onOpenChange}
          onTap={onEdit}
          onLongPress={onLongPress}
          wrapClass="card-wrap"
          frontClass={'card' + (task.done ? ' done' : '')}
        >
          <div className="row1">
            <div className="left">
              <span className="cat">{task.category}</span>
              {/* 膠囊的順序：重要（紅）→ 截止（藍）→ 延 N 天；重複標記是純文字，放最後 */}
              {task.important && <span className="pill imp">重要</span>}
              {task.deadline && <span className="pill dl">截止</span>}
              {!task.done && task.delayDays > 0 && <span className="pill delay">延 {task.delayDays} 天</span>}
              {task.repeat && <span className="rep">↻ {REPEAT_LABEL[task.repeat.freq]}</span>}
            </div>
            <span className="time">{task.time}</span>
          </div>
          <span className="title">{task.title}</span>
          {task.note && <span className="note">{task.note}</span>}
        </SwipeRow>
      </div>
    </div>
  );
}
