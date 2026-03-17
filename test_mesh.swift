import ARKit
import SceneKit
import Metal

@available(iOS 13.4, *)
func testMesh(anchor: ARMeshAnchor) -> SCNGeometry {
    let vertices = anchor.geometry.vertices
    let normals = anchor.geometry.normals
    let faces = anchor.geometry.faces
    
    let vertexSource = SCNGeometrySource(buffer: vertices.buffer, vertexFormat: vertices.format, semantic: .vertex, vertexCount: vertices.count, dataOffset: vertices.offset, dataStride: vertices.stride)
    
    let normalSource = SCNGeometrySource(buffer: normals.buffer, vertexFormat: normals.format, semantic: .normal, vertexCount: normals.count, dataOffset: normals.offset, dataStride: normals.stride)
    
    let data = Data(bytesNoCopy: faces.buffer.contents(), count: faces.buffer.length, deallocator: .none)
    let geometryElement = SCNGeometryElement(data: data, primitiveType: .triangles, primitiveCount: faces.count, bytesPerIndex: faces.bytesPerIndex)
    
    let geo = SCNGeometry(sources: [vertexSource, normalSource], elements: [geometryElement])
    return geo
}
