#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface MeshDecimator : NSObject

+ (NSDictionary *)decimateMeshVertices:(NSData *)verticesData
                                 faces:(NSData *)facesData
                           targetCount:(NSInteger)targetCount;

@end

NS_ASSUME_NONNULL_END
