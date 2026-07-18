import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class RealtimeEventsService {
  private readonly jefesSubject = new Subject<any>();
  private readonly bossSubjects = new Map<string, Subject<any>>();
  private readonly employeeSubjects = new Map<string, Subject<any>>();
  private readonly driverSubjects = new Map<string, Subject<any>>();
  private readonly clientSubjects = new Map<string, Subject<any>>();

  getJefesStream(): Observable<MessageEvent> {
    return this.jefesSubject.asObservable().pipe(
      map((data) => ({
        data,
      })),
    );
  }

  getBossStream(bossId: string): Observable<MessageEvent> {
    if (!this.bossSubjects.has(bossId)) {
      this.bossSubjects.set(bossId, new Subject<any>());
    }
    return this.bossSubjects
      .get(bossId)!
      .asObservable()
      .pipe(map((data) => ({ data })));
  }

  getEmployeeStream(empleadaId: string): Observable<MessageEvent> {
    if (!this.employeeSubjects.has(empleadaId)) {
      this.employeeSubjects.set(empleadaId, new Subject<any>());
    }
    return this.employeeSubjects
      .get(empleadaId)!
      .asObservable()
      .pipe(
        map((data) => ({
          data,
        })),
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
        map((data) => ({
          data,
        })),
      );
  }

  getClientStream(clienteId: string): Observable<MessageEvent> {
    if (!this.clientSubjects.has(clienteId)) {
      this.clientSubjects.set(clienteId, new Subject<any>());
    }
    return this.clientSubjects
      .get(clienteId)!
      .asObservable()
      .pipe(map((data) => ({ data })));
  }

  emitToJefes(event: any) {
    this.jefesSubject.next(event);
  }

  emitToBoss(bossId: string, event: any) {
    this.bossSubjects.get(bossId)?.next(event);
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

  emitToClient(clienteId: string, event: any) {
    this.clientSubjects.get(clienteId)?.next(event);
  }
}
