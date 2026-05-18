#import "MeshDecimator.h"
#import "Simplify.h"
#include <vector>

@implementation MeshDecimator

+ (NSDictionary *)decimateMeshVertices:(NSData *)verticesData
                                 faces:(NSData *)facesData
                           targetCount:(NSInteger)targetCount {
    if (verticesData.length == 0 || facesData.length == 0) {
        return @{@"vertices": [NSData data], @"faces": [NSData data]};
    }
    
    const float *vPtr = (const float *)verticesData.bytes;
    NSInteger numVertices = verticesData.length / (3 * sizeof(float));
    
    const int32_t *fPtr = (const int32_t *)facesData.bytes;
    NSInteger numFaces = facesData.length / (3 * sizeof(int32_t));
    
    Simplify::vertices.clear();
    Simplify::triangles.clear();
    Simplify::refs.clear();
    
    Simplify::vertices.reserve(numVertices);
    for (NSInteger i = 0; i < numVertices; i++) {
        Simplify::Vertex v;
        v.p.x = vPtr[i*3 + 0];
        v.p.y = vPtr[i*3 + 1];
        v.p.z = vPtr[i*3 + 2];
        v.tstart = 0;
        v.tcount = 0;
        v.border = 0;
        Simplify::vertices.push_back(v);
    }
    
    Simplify::triangles.reserve(numFaces);
    for (NSInteger i = 0; i < numFaces; i++) {
        Simplify::Triangle t;
        t.v[0] = fPtr[i*3 + 0];
        t.v[1] = fPtr[i*3 + 1];
        t.v[2] = fPtr[i*3 + 2];
        t.attr = 0;
        t.material = 0;
        t.deleted = 0;
        t.dirty = 0;
        t.err[0] = 0; t.err[1] = 0; t.err[2] = 0; t.err[3] = 0;
        Simplify::triangles.push_back(t);
    }
    
    Simplify::simplify_mesh((int)targetCount, 7.0, false);
    
    NSMutableData *outVData = [NSMutableData dataWithCapacity:Simplify::vertices.size() * 3 * sizeof(float)];
    for (size_t i = 0; i < Simplify::vertices.size(); i++) {
        float v[3];
        v[0] = (float)Simplify::vertices[i].p.x;
        v[1] = (float)Simplify::vertices[i].p.y;
        v[2] = (float)Simplify::vertices[i].p.z;
        [outVData appendBytes:v length:sizeof(v)];
    }
    
    NSMutableData *outFData = [NSMutableData dataWithCapacity:Simplify::triangles.size() * 3 * sizeof(int32_t)];
    for (size_t i = 0; i < Simplify::triangles.size(); i++) {
        if (!Simplify::triangles[i].deleted) {
            int32_t f[3];
            f[0] = Simplify::triangles[i].v[0];
            f[1] = Simplify::triangles[i].v[1];
            f[2] = Simplify::triangles[i].v[2];
            [outFData appendBytes:f length:sizeof(f)];
        }
    }
    
    Simplify::vertices.clear();
    Simplify::triangles.clear();
    Simplify::refs.clear();
    
    return @{
        @"vertices": outVData,
        @"faces": outFData
    };
}

@end
