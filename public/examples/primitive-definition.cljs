;; Example: Primitive Definition
;; Defining new type of primitives

(defn star
  {:doc "Generates a star path"

   ;; Parameter annotation
   :params
   [{:label "Center" :type "vec2"}
    {:label "Num of Vertices" :type "number"
     :constraints {:min 2 :step 1}}
    {:label "Inner Radius" :type "number"
     :constraints {:min 0}}
    {:label "Outer Radius" :type "number"
     :constraints {:min 0}}]

   ;; Handles definition
   :handles
   {:draw-handle
    ;; Returns a list of handles with ID
    ;; from the function's parameters
    (fn [c n rmin rmax]
      [{:id :center :type "point" :pos c}
       {:id :rmin
        :type "point"
        :pos (vec2/+
              c
              (vec2/dir (/ PI n) rmin))}
       {:id :rmax
        :type "point"
        :pos (vec2/+
              c
              (vec2/dir 0 rmax))}])
    :on-drag
    ;; In turn, returns new parameters
    ;; from the handle's ID and position
    (fn [id pos [c n rmin rmax]]
      (case id
        :center [pos n rmin rmax]
        :rmin [c n (vec2/dist c pos) rmax]
        :rmax [c n rmin (vec2/dist c pos)]))}}

  ;; Function body
  [c n rmin rmax]
  (apply polygon
         (for [i (range (* n 2))]
           (let [a (* (/ i n) PI)
                 r (if (mod i 2) rmin rmax)]
             (vec2/+ c (vec2/dir a r))))))

:start-sketch

(background "#4c5366")

[:g {:style (fill "#fb6a4c")}
  ;; Try click 'star' on below
  ;; then you can see the inspector
  ;; and handles on the view
 (star [200 200] 5 70 180)]