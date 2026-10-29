import { calendarView } from '../calendar-view.js';

export function calendarPage(container) {
  container.append(calendarView({ pageLayout: true }));
}
