import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class RealtimeEventsService {
  private readonly jefesSubject = new Subject<any>();
  private readonly employeeSubjects = new Map<string, Subject<any>>();
  private readonly driverSubjects = new Map<string, Subject<any>>();

  getJefesStream(): Observable<MessageEvent> {
    return this.jefesSubject.asObservable().pipe(
      map(
        (data) =>
          ({
            data,
          }) as MessageEvent,
      ),
    );
  }

  getEmployeeStream(empleadaId: string): Observable<MessageEvent> {
    if (!this.employeeSubjects.has(empleadaId)) {
      this.employeeSubjects.set(empleadaId, new Subject<any>());
    }
    return this.employeeSubjects
      .get(empleadaId)!
      .asObservable()
      .pipe(
        map(
          (data) =>
            ({
              data,
            }) as MessageEvent,
        ),
      );
  }

  getDriverStream(choferId: string): Observable<MessageEvent> {
    if (!this.driverSubjects.has(choferId)) {
      this.driverSubjects.set(choferId, new Subject<any>());
    }
    return this.driverSubjects
      .get(choferId)!
      .asObservable()
      .pipe(
        map(
          (data) =>
            ({
              data,
            }) as MessageEvent,
        ),
      );
  }

  emitToJefes(event: any) {
    this.jefesSubject.next(event);
  }

  emitToEmployee(empleadaId: string, event: any) {
    const subject = this.employeeSubjects.get(empleadaId);
    if (subject) {
      subject.next(event);
    }
  }

  emitToDriver(choferId: string, event: any) {
    const subject = this.driverSubjects.get(choferId);
    if (subject) {
      subject.next(event);
    }
  }
}
