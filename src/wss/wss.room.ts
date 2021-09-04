import config from 'config';
import io from 'socket.io';

import { types as mediasoupTypes } from "mediasoup";
import { IRoom, IRoomClient } from './wss.interfaces';
import { Logger } from '@nestjs/common';
import { RouterOptions, Worker } from 'mediasoup/lib/types';

const mediasoupSettings = config.get<IMediasoupSettings>('MEDIASOUP_SETTINGS');
type TPeer = 'producer' | 'consumer';

export class WssRoom implements IRoom {
    public readonly clients: Map<string, IRoomClient> = new Map();
    public router: mediasoupTypes.Router;
    public audioLevelObserver: mediasoupTypes.AudioLevelObserver;
    private logger: Logger = new Logger('WssRoom');

    constructor(
        private worker: Worker,
        public workerIndex: number,
        public readonly session_id: string,
        private readonly wssServer: io.Server
      ) {}

    private async configureWorker() {
        try {   
            // Stringify and parse JSON to bypass object read-only error
            this.router = await this.worker.createRouter({
                mediaCodecs: JSON.parse(JSON.stringify(mediasoupSettings.router.mediaCodecs))
            } as RouterOptions);

            this.audioLevelObserver = await this.router.createAudioLevelObserver({ maxEntries: 1, threshold: -80, interval: 800 });

            this.audioLevelObserver.on('volumes', (volumes: Array<{ producer: mediasoupTypes.Producer; volume: number }>) => {
                this.wssServer.to(this.session_id).emit('mediaActiveSpeaker', {
                    peerId: (volumes[0].producer.appData as { peerId: string }).peerId,
                    volume: volumes[0].volume,
                });
            })
            this.audioLevelObserver.on('silence', () => {
                this.wssServer.to(this.session_id).emit('mediaActiveSpeaker', {
                    peerId: null,
                });
            });
            // await this.worker
            // .createRouter({ mediaCodecs: mediasoupSettings.router.mediaCodecs } as RouterOptions)
            // .then(router => {
            //     this.logger.log('router initialized');

            //     this.router = router;
            //     return this.router.createAudioLevelObserver({ maxEntries: 1, threshold: -80, interval: 800 });
            // })
            // .then(observer => (this.audioLevelObserver = observer))
            // .then(() => {
            //     // tslint:disable-next-line: no-any
            //     this.audioLevelObserver.on('volumes', (volumes: Array<{ producer: mediasoupTypes.Producer; volume: number }>) => {
            //     this.wssServer.to(this.session_id).emit('mediaActiveSpeaker', {
            //         peerId: (volumes[0].producer.appData as { peerId: string }).peerId,
            //         volume: volumes[0].volume,
            //     });
            //     });

            //     this.audioLevelObserver.on('silence', () => {
            //     this.wssServer.to(this.session_id).emit('mediaActiveSpeaker', {
            //         peerId: null,
            //     });
            //     });
            // });
        } catch (error) {
            this.logger.error(error.message, error.stack, 'WssRoom - configureWorker');
        }
    }

    public async createWebRtcTransport(data: { type: TPeer }, peerId: string): Promise<object> {
        try {
          this.logger.log(`room ${this.session_id} createWebRtcTransport - ${data.type}`);
    
          const user = this.clients.get(peerId);
    
          const { initialAvailableOutgoingBitrate } = mediasoupSettings.webRtcTransport;
    
          const transport = await this.router.createWebRtcTransport({
            listenIps: mediasoupSettings.webRtcTransport.listenIps,
            enableUdp: true,
            enableSctp: true,
            enableTcp: true,
            initialAvailableOutgoingBitrate,
            appData: { peerId, type: data.type },
          });
    
          switch (data.type) {
            case 'producer':
              user.media.producerTransport = transport;
              break;
            case 'consumer':
              user.media.consumerTransport = transport;
              break;
          }
    
        //   await this.updateMaxIncomingBitrate();
    
          return {
            params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            },
            type: data.type,
          };
        } catch (error) {
          this.logger.error(error.message, error.stack, 'MediasoupHelper - createWebRtcTransport');
        }
      }

    close(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    public async load(): Promise<void> {
        try {
            await this.configureWorker()
        } catch (error) {
            this.logger.log("Error", error)
        }
    }

    get clientCount(): number {
        return this.clients.size;
    }

    get clientsIds(): string[] {
        return Array.from(this.clients.keys());
    }

    get audioProducerIds(): string[] {
        return Array.from(this.clients.values())
          .filter(c => {
            if (c.media && c.media.producerAudio && !c.media.producerAudio.closed) {
              return true;
            }
    
            return false;
          })
          .map(c => c.id);
      }
    
      get videoProducerIds(): string[] {
        return Array.from(this.clients.values())
          .filter(c => {
            if (c.media && c.media.producerVideo && !c.media.producerVideo.closed) {
              return true;
            }
    
            return false;
          })
          .map(c => c.id);
      }
    
      get producerIds(): string[] {
        return Array.from(this.clients.values())
          .filter(c => {
            if (c.media) {
              if (c.media.producerVideo || c.media.producerAudio) {
                return true;
              } else {
                return false;
              }
            } else {
              return false;
            }
          })
          .map(c => c.id);
      }
    
      public getRouterRtpCapabilities(): mediasoupTypes.RtpCapabilities {
        return this.router.rtpCapabilities;
      }
    
      get stats() {
        const clientsArray = Array.from(this.clients.values());
    
        return {
          id: this.session_id,
          worker: this.workerIndex,
          clients: clientsArray.map(c => ({
            id: c.id,
            produceAudio: c.media.producerAudio ? true : false,
            produceVideo: c.media.producerVideo ? true : false,
          })),
        };
      }
}