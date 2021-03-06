import io from 'socket.io';

import { Consumer, DtlsParameters, MediaKind, Producer, RtpCapabilities, WebRtcTransport } from 'mediasoup/lib/types';

type UserType = 'producer' | 'consumer'

export interface IProduceTrack {
  rtpParameters: RTCRtpParameters
  kind: MediaKind
  room: string
  peerId: string
  paused: boolean
}

export interface IProducerConnectorTransport {
  dtlsParameters: DtlsParameters
  room: string
  peerId: string
  type: UserType
}

export interface IPeerConnection {
    peerId: string
    room: string
    profile: IClientProfile
}

export interface IRoom {
    load(): Promise<void>
    close(): 
    Promise<void>
}

export interface IRoomMessageWrapper {
  room: string;
  message: IRoomMessage;
}

export interface IRoomMessage {
  content: string
  from: IClientProfile
}

export interface IClientQuery {
  readonly user_id: string;
  readonly session_id: string;
  readonly device: string;
}

export interface IClientProfile {
  username: string;
  firstName: string;
  lastName: string;
  picture: string;
}

export interface IRoomClient {
  id: string;
  io: io.Socket;
  media?: IMediasoupClient;
  profile: IClientProfile
}

export interface IMediasoupClient {
  producerVideo?: Producer;
  producerAudio?: Producer;
  producerTransport?: WebRtcTransport;
  consumerTransport?: WebRtcTransport;
  consumersVideo?: Map<string, Consumer>;
  consumersAudio?: Map<string, Consumer>;
}

export interface IPeerTransport {
  type: UserType
  peerId: string;
  room: string;
  forceTcp: boolean;
  rtpCapabilities: RtpCapabilities
  kind?: MediaKind
}

export interface IWorkerInfo {
  workerIndex: number;
  clientsCount: number;
  roomsCount: number;
  pidInfo?: object;
}

export interface IMsMessage {
  readonly action:
    | 'getRouterRtpCapabilities'
    | 'createWebRtcTransport'
    | 'connectWebRtcTransport'
    | 'produce'
    | 'consume'
    | 'restartIce'
    | 'requestConsumerKeyFrame'
    | 'getTransportStats'
    | 'getProducerStats'
    | 'getConsumerStats'
    | 'getAudioProducerIds'
    | 'getVideoProducerIds'
    | 'producerClose'
    | 'producerPause'
    | 'producerResume'
    | 'allProducerClose'
    | 'allProducerPause'
    | 'allProducerResume';
  readonly data?: object;
}