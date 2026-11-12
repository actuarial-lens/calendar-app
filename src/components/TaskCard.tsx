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
}

export function TaskCard({ task, phase, open, anyOpen, actions, startActions, openKey, onOpenChange, onEdit }: Props) {
  return (
    <div className={'collapse ' + phase}>
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
          wrapClass="card-wrap"
          frontClass={'card' + (task.done ? ' done' : '')}
        >
          <div className="row1">
            <div className="left">
              <span className="cat">{task.category}</span>
              {task.repeat && <span className="rep">↻ {REPEAT_LABEL[task.repeat.freq]}</span>}
              {!task.done && task.delayDays > 0 && <span className="delay">延 {task.delayDays} 天</span>}
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
