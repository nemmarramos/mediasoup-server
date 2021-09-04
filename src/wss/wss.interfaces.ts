import io from 'socket.io';

import { Consumer, Producer, RtpCapabilities, WebRtcTransport } from 'mediasoup/lib/types';

export interface IPeerConnection {
    peerId: string
    room: string
}

export interface IRoom {
    load(): Promise<void>
    close(): Promise<void>
}

export interface IClientQuery {
  readonly user_id: string;
  readonly session_id: string;
  readonly device: string;
}

export interface IRoomClient {
  id: string;
  io: io.Socket;
  media?: IMediasoupClient;
}

export interface IMediasoupClient {
  producerVideo?: Producer;
  producerAudio?: Producer;
  producerTransport?: WebRtcTransport;
  consumerTransport?: WebRtcTransport;
  consumersVideo?: Map<string, Consumer>;
  consumersAudio?: Map<string, Consumer>;
}

export interface IProducerTransport {
  peerId: string;
  forceTcp: boolean;
  rtpCapabilities: RtpCapabilities
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