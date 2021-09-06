import config from 'config';
import io from 'socket.io';

import { types as mediasoupTypes } from "mediasoup";
import { IPeerTransport, IProducerConnectorTransport, IProduceTrack, IRoom, IRoomClient } from './wss.interfaces';
import { Logger } from '@nestjs/common';
import { ConsumerLayers, ConsumerScore, Producer, RouterOptions, Worker } from 'mediasoup/lib/types';

const mediasoupSettings = config.get<IMediasoupSettings>('MEDIASOUP_SETTINGS');
type TPeer = 'producer' | 'consumer';

export class WssRoom implements IRoom {
    public readonly clients: Map<string, IRoomClient> = new Map();
    public router: mediasoupTypes.Router;
    public audioLevelObserver: mediasoupTypes.AudioLevelObserver;
    private logger: Logger = new Logger('WssRoom');
    private host: IRoomClient;

    constructor(
        private worker: Worker,
        public workerIndex: number,
        public readonly room: string,
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
                this.wssServer.to(this.room).emit('mediaActiveSpeaker', {
                    peerId: (volumes[0].producer.appData as { peerId: string }).peerId,
                    volume: volumes[0].volume,
                });
            })
            this.audioLevelObserver.on('silence', () => {
                this.wssServer.to(this.room).emit('mediaActiveSpeaker', {
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
            //     this.wssServer.to(this.room).emit('mediaActiveSpeaker', {
            //         peerId: (volumes[0].producer.appData as { peerId: string }).peerId,
            //         volume: volumes[0].volume,
            //     });
            //     });

            //     this.audioLevelObserver.on('silence', () => {
            //     this.wssServer.to(this.room).emit('mediaActiveSpeaker', {
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
          this.logger.log(`room ${this.room} createWebRtcTransport - ${data.type}`);
    
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

    public async consume(data: IPeerTransport, peerId?: string) {
        try {
            this.logger.log(`room ${this.room} consume peerId ${data.peerId}`);
            const user = this.clients.get(data.peerId);

            let fromProducer: Producer

            const hostClient = this.clients.get(peerId ? peerId : this.host.id)
            console.log('hostClient', hostClient.media.producerVideo)
            console.log('data.kind', data.kind)
            console.log('this.host.id',  this.host.id)
            
            if (data.kind === 'video') {
                fromProducer = hostClient.media.producerVideo
            }
          
            if (data.kind === 'audio') {
                fromProducer = hostClient.media.producerAudio
            }

            console.log('data.rtpCapabilities', data.rtpCapabilities)
            const { rtpCapabilities } = this.router
            if (
                !fromProducer ||
                !rtpCapabilities ||
                !this.router.canConsume({
                  producerId: fromProducer.id,
                  rtpCapabilities,
                })
              ) {
                throw new Error(
                  `Couldn't consume ${data.kind} with 'peerId'=${user.id} and 'room_id'=${this.room}`
                );
            }


            const transport = user.media.consumerTransport;

            const consumer = await transport.consume({
                producerId: fromProducer.id,
                rtpCapabilities,
                paused: data.kind === 'video',
                appData: { peerId, kind: data.kind, producer_user_id: data.peerId },
              });
        
              switch (data.kind) {
                case 'video':
                  if (!user.media.consumersVideo) {
                    user.media.consumersVideo = new Map();
                  }
        
                  user.media.consumersVideo.set(data.peerId, consumer);
        
                  consumer.on('transportclose', async () => {
                    consumer.close();
                    user.media.consumersVideo.delete(data.peerId);
                  });
        
                  consumer.on('producerclose', async () => {
                    user.io.emit('mediaProducerClose', { peerId: data.peerId, kind: data.kind });
                    consumer.close();
                    user.media.consumersVideo.delete(data.peerId);
                  });
                  break;
                case 'audio':
                  if (!user.media.consumersAudio) {
                    user.media.consumersAudio = new Map();
                  }
        
                  user.media.consumersAudio.set(data.peerId, consumer);
        
                  consumer.on('transportclose', async () => {
                    consumer.close();
                    user.media.consumersAudio.delete(data.peerId);
                  });
        
                  consumer.on('producerclose', async () => {
                    user.io.emit('mediaProducerClose', { peerId: data.peerId, kind: data.kind });
                    consumer.close();
                    user.media.consumersAudio.delete(data.peerId);
                  });
                  break;
              }
        
              consumer.on('producerpause', async () => {
                await consumer.pause();
                user.io.emit('mediaProducerPause', { peerId: data.peerId, kind: data.kind });
              });
        
              consumer.on('producerresume', async () => {
                await consumer.resume();
                user.io.emit('mediaProducerResume', { peerId: data.peerId, kind: data.kind });
              });
        
              consumer.on('score', (score: ConsumerScore) => {
                this.logger.debug(
                  `room ${this.room} user ${peerId} consumer ${data.kind} score ${JSON.stringify(score)}`
                );
              });
        
              consumer.on('debug', (layers: ConsumerLayers | null) => {
                this.logger.debug(
                  `room ${this.room} user ${peerId} consumer ${data.kind} layerschange ${JSON.stringify(layers)}`
                );
              });
        
              if (consumer.kind === 'video') {
                await consumer.resume();
              }
        
              return {
                producerId: fromProducer.id,
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                type: consumer.type,
                producerPaused: consumer.producerPaused,
              };
        } catch (error) {
            this.logger.error(error.message, error.stack, 'MediasoupHelper - consume');
        }
    }

    public async connectWebRTCTransport(data: IProducerConnectorTransport) {
        try {
            const user = this.clients.get(data.peerId);
            
            if (data.type === 'producer') {
                await user.media.producerTransport.connect({ dtlsParameters: data.dtlsParameters });
            }
            
            if (data.type === 'consumer') {
                await user.media.consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
            }
            return true
        } catch (error) {
            this.logger.error(error.message, error.stack, 'MediasoupHelper - connectProducerTransport');
        }
    }

    public async produce(data: IProduceTrack): Promise<string> {
        try {
            this.logger.log("wss:produce")
            const user = this.clients.get(data.peerId);
            const transport = user.media.producerTransport;
            if (!transport) {
                throw new Error(`Couldn't find producer transport with 'peerId'=${data.peerId} and 'room_id'=${this.room}`);
            }
            const producer = await transport.produce({ ...data, appData: { peerId: data.peerId, kind: data.kind } });
            this.logger.log("data.kind", data.kind)

            if (data.kind === 'video') {
                this.logger.log("video produce")

                user.media.producerVideo = producer;
            }
            if (data.kind === 'audio') {
                user.media.producerAudio = producer;
                await this.audioLevelObserver.addProducer({ producerId: producer.id });
            }

            return producer.id
        } catch (error) {
            this.logger.log("Error", error)
            return Promise.resolve(null)
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

    public setHost(user: IRoomClient) {
        this.host = user;
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

      public async addClient(peerId: string, client: io.Socket): Promise<boolean> {
        try {
          this.logger.debug(`${peerId} connected to room ${this.room}`);
    
          this.clients.set(peerId, { io: client, id: peerId, media: {} });
    
          client.join(this.room);
    
        //   this.broadcastAll('mediaClientConnected', {
        //     id: peerId,
        //   });
    
          return true;
        } catch (error) {
          this.logger.error(error.message, error.stack, 'WssRoom - addClient');
        }
      }
    
      get stats() {
        const clientsArray = Array.from(this.clients.values());
    
        return {
          id: this.room,
          worker: this.workerIndex,
          clients: clientsArray.map(c => ({
            id: c.id,
            produceAudio: c.media.producerAudio ? true : false,
            produceVideo: c.media.producerVideo ? true : false,
          })),
        };
      }
}